/**
 * Navigation decision engine — the pure, fully testable core of G-Container.
 *
 * `decideNavigation()` takes an immutable description of a top-level navigation
 * and returns what should happen. It performs no I/O, touches no browser API and
 * has no side effects, which is what makes the behaviour deterministic and easy
 * to cover with unit tests (see test/decision.test.ts).
 *
 * The background worker is then a thin, boring adapter: gather facts, call this
 * function, execute the returned action.
 */

import type { MatchResult, Settings } from '../types/index.js';
import type { UrlMatcher } from './matcher.js';

/** Everything the engine needs to know about one navigation. */
export interface NavigationContext {
  readonly url: string;
  readonly tabId: number;
  /** Cookie store the tab currently lives in ("firefox-default" when none). */
  readonly cookieStoreId: string;
  /** The Google container's cookie store id, or null when unavailable. */
  readonly containerId: string | null;
  /** Tab that opened this one, when the navigation came from window.open/target=_blank. */
  readonly openerTabId: number | null;
  /** Cookie store of the opener tab, when known. */
  readonly openerCookieStoreId: string | null;
  /** True for private-window tabs. */
  readonly incognito: boolean;
  /** Monotonic timestamp (ms) used for loop detection. */
  readonly now: number;
}

export type NavigationAction =
  /** Leave the navigation alone. */
  | { readonly kind: 'ignore'; readonly reason: string }
  /** Cancel and reopen `url` inside the Google container. */
  | {
      readonly kind: 'contain';
      readonly url: string;
      readonly cookieStoreId: string;
      readonly replaceTabId: number;
      readonly reason: string;
    }
  /** Cancel and reopen `url` outside any container (default store). */
  | {
      readonly kind: 'release';
      readonly url: string;
      readonly replaceTabId: number;
      readonly reason: string;
    }
  /** Cancel and open the unwrapped destination outside the container. */
  | {
      readonly kind: 'unwrap';
      readonly url: string;
      readonly targetOutside: boolean;
      readonly replaceTabId: number;
      readonly reason: string;
    };

export const DEFAULT_COOKIE_STORE = 'firefox-default';

/**
 * Guards against redirect loops.
 *
 * A loop happens when site A bounces to site B which bounces back to A while we
 * keep re-containerizing. We therefore remember, per tab, the URLs we have
 * already acted on within a short window and refuse to act twice on the same
 * (tab, url) pair. Entries expire so long-lived tabs do not grow the map.
 */
export class LoopGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = 3000,
    private readonly maxEntries = 500
  ) {}

  private key(tabId: number, url: string): string {
    return `${tabId}\u0000${url}`;
  }

  /** Returns true when this (tab, url) was already handled recently. */
  isRepeat(tabId: number, url: string, now: number): boolean {
    const at = this.seen.get(this.key(tabId, url));
    return at !== undefined && now - at < this.windowMs;
  }

  remember(tabId: number, url: string, now: number): void {
    if (this.seen.size >= this.maxEntries) this.prune(now);
    this.seen.set(this.key(tabId, url), now);
  }

  forgetTab(tabId: number): void {
    const prefix = `${tabId}\u0000`;
    for (const key of this.seen.keys()) {
      if (key.startsWith(prefix)) this.seen.delete(key);
    }
  }

  prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at >= this.windowMs) this.seen.delete(key);
    }
    // Hard cap: if everything is still fresh, drop the oldest half.
    if (this.seen.size >= this.maxEntries) {
      const entries = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < Math.floor(entries.length / 2); i++) {
        this.seen.delete(entries[i]![0]);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}

/** True when protection is currently active. */
export function isProtectionActive(settings: Settings, now: number): boolean {
  if (!settings.enabled) return false;
  if (settings.pausedUntil > now) return false;
  return true;
}

export interface DecisionDeps {
  readonly settings: Settings;
  readonly matcher: UrlMatcher;
  readonly loopGuard: LoopGuard;
}

/**
 * Decide what to do with a top-level navigation.
 *
 * The order of checks is deliberate and documented inline; changing it changes
 * observable behaviour, so every branch is covered by a test.
 */
export function decideNavigation(context: NavigationContext, deps: DecisionDeps): NavigationAction {
  const { settings, matcher, loopGuard } = deps;
  const { url, tabId, cookieStoreId, containerId, now } = context;

  if (!isProtectionActive(settings, now)) {
    return { kind: 'ignore', reason: 'protection-inactive' };
  }

  // Only http(s) navigations are candidates; about:, view-source:, file: etc.
  // are never containerized.
  if (!/^https?:\/\//i.test(url)) {
    return { kind: 'ignore', reason: 'unsupported-scheme' };
  }

  if (context.incognito && !settings.behaviour.handlePrivateWindows) {
    // Private windows already have an isolated cookie jar; opting in is a
    // user choice because moving tabs between private and container contexts
    // is not possible in Firefox.
    return { kind: 'ignore', reason: 'private-window' };
  }

  if (containerId === null) {
    return { kind: 'ignore', reason: 'container-unavailable' };
  }

  // Loop breaker: never act twice on the same (tab, url) in quick succession.
  if (loopGuard.isRepeat(tabId, url, now)) {
    return { kind: 'ignore', reason: 'loop-guard' };
  }

  const inContainer = cookieStoreId === containerId;
  const match: MatchResult = matcher.match(url);

  // --- Case A: a Google URL loading outside the container -------------------
  if (!inContainer && match.isGoogle) {
    // Third-party sign-in: keep the OAuth handshake in the caller's context so
    // the relying party receives its cookies/callback in the right jar.
    if (
      settings.behaviour.oauthPassthrough &&
      matcher.isOAuthEndpoint(url) &&
      context.openerTabId !== null &&
      context.openerCookieStoreId !== containerId
    ) {
      return { kind: 'ignore', reason: 'oauth-passthrough' };
    }
    return {
      kind: 'contain',
      url,
      cookieStoreId: containerId,
      replaceTabId: tabId,
      reason: `match:${match.source}`,
    };
  }

  // --- Case B: navigation happening inside the container --------------------
  if (inContainer) {
    // B1: a Google redirector pointing at an external site — unwrap it so the
    // user lands on the real destination outside the container, exactly once.
    if (settings.behaviour.unwrapRedirectors) {
      const unwrapped = matcher.unwrapRedirector(url);
      if (unwrapped !== null) {
        return {
          kind: 'unwrap',
          url: unwrapped,
          targetOutside: true,
          replaceTabId: tabId,
          reason: 'redirector',
        };
      }
    }

    // B2: a genuinely non-Google page opened inside the container. Push it back
    // out so the container only ever holds Google state.
    if (!match.isGoogle && settings.behaviour.releaseNonGoogle) {
      return {
        kind: 'release',
        url,
        replaceTabId: tabId,
        reason: 'non-google-in-container',
      };
    }
  }

  return { kind: 'ignore', reason: match.isGoogle ? 'already-contained' : 'not-google' };
}
