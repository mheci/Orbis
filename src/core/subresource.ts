/**
 * Third-party Google resource classification.
 *
 * When a website that is not Google loads a Google resource, that request tells
 * Google your IP address, your user agent, and which page you are reading, even
 * when no cookie is attached. Containment alone does not stop that, because
 * containment only decides which cookie compartment a request belongs to.
 * Cancelling the request does stop it.
 *
 * The hard part is deciding what to cancel. Facebook Container blocks every
 * Meta resource on other sites, which is safe because virtually nothing on the
 * web needs Meta code to function. Google is not comparable: fonts, hosted
 * script libraries, reCAPTCHA and embedded players are load-bearing across a
 * large share of the web. Blocking those by default would break sites and call
 * it privacy.
 *
 * So resources are classified, and only the ones with no purpose beyond
 * observation are blocked by default.
 */

import subresourceData from '../domains/subresources.json';
import { getDomainDatabase, normalizeHostPattern, type DomainDatabase } from './domain-db.js';
import { safeParse, type UrlMatcher } from './matcher.js';

/**
 * Is this host Google-owned?
 *
 * Deliberately separate from `UrlMatcher`, which answers a different question:
 * whether a top-level navigation should be moved into the container. That one
 * respects the user's domain-set choices, and advertising domains are switched
 * off there because landing on one is usually an ad click passing through to
 * somewhere else.
 *
 * Ownership does not depend on those preferences. google-analytics.com belongs
 * to Google whether or not the user wants ad click-throughs contained, and it
 * is exactly the host that most needs blocking when embedded elsewhere.
 * Conflating the two made the blocker ignore every tracking domain.
 */
function buildOwnershipIndex(db: DomainDatabase): {
  hosts: ReadonlySet<string>;
  brandTLDs: ReadonlySet<string>;
} {
  const hosts = new Set<string>();
  for (const set of db.sets) {
    for (const host of set.hosts) hosts.add(host);
  }
  return { hosts, brandTLDs: new Set(db.brandTLDs) };
}

/** How a third-party Google resource is categorised. */
export type ResourceClass = 'tracking' | 'social' | 'functional' | 'unknown';

/** What to do about a third-party Google sub-resource request. */
export type SubresourceAction = 'allow' | 'block';

export interface SubresourceDecision {
  readonly action: SubresourceAction;
  readonly resourceClass: ResourceClass;
  /** Why the decision was reached, for diagnostics and tests. */
  readonly reason: string;
  /** The pattern that matched, when one did. */
  readonly pattern?: string;
}

/** Blocking modes, from least to most aggressive. */
export type BlockingMode = 'off' | 'standard' | 'strict';

export interface SubresourceContext {
  /** The resource being requested. */
  readonly url: string;
  /** The page making the request. Null when the browser did not report one. */
  readonly originUrl: string | null;
  /** webRequest resource type, e.g. 'script', 'image', 'sub_frame'. */
  readonly type: string;
  /** Whether the top-level tab is inside the Google container. */
  readonly tabInContainer: boolean;
}

const ALLOW = (reason: string, cls: ResourceClass = 'unknown'): SubresourceDecision => ({
  action: 'allow',
  resourceClass: cls,
  reason,
});

/**
 * Resource types that are never blocked regardless of classification.
 *
 * A cancelled top-level document or a cancelled stylesheet produces a visibly
 * broken page rather than a quietly protected one. Document loads are handled
 * by the navigation engine instead, which moves them into the container.
 */
const NEVER_BLOCK_TYPES = new Set(['main_frame', 'stylesheet', 'font']);

interface HostPathEntry {
  readonly host: string;
  readonly path: string;
}

function parseEntry(raw: string): HostPathEntry {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  const slash = value.indexOf('/');
  if (slash === -1) return { host: normalizeHostPattern(value), path: '' };
  return {
    host: normalizeHostPattern(value.slice(0, slash)),
    path: value.slice(slash),
  };
}

function hostMatches(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

function entryMatches(entry: HostPathEntry, host: string, path: string): boolean {
  if (!hostMatches(host, entry.host)) return false;
  if (entry.path === '') return true;
  return path.startsWith(entry.path);
}

/**
 * Compare two hostnames for "same site" purposes.
 *
 * Uses the last two labels, which is a deliberate approximation: a full public
 * suffix list would be more precise but would add a large dependency and a
 * regular update obligation to answer a question that only needs to be roughly
 * right. Being wrong here means treating a resource as first-party when it is
 * technically third-party, which errs towards not breaking the page.
 */
function sameSite(a: string, b: string): boolean {
  if (a === b) return true;
  const left = a.split('.').slice(-2).join('.');
  const right = b.split('.').slice(-2).join('.');
  return left === right && left.includes('.');
}

export class SubresourceClassifier {
  private readonly tracking: readonly HostPathEntry[];
  private readonly social: readonly HostPathEntry[];
  private readonly functional: readonly HostPathEntry[];
  private readonly functionalPaths: readonly string[];
  private readonly neverBlock: readonly HostPathEntry[];
  private readonly allowlist: readonly HostPathEntry[];

  private readonly ownedHosts: ReadonlySet<string>;
  private readonly ownedBrandTLDs: ReadonlySet<string>;

  /** Cache keyed by origin host plus resource URL. */
  private readonly cache = new Map<string, SubresourceDecision>();
  private static readonly CACHE_LIMIT = 1024;

  constructor(
    private readonly mode: BlockingMode,
    /** Sites the user has chosen to exempt entirely. */
    allowlist: readonly string[] = [],
    private readonly matcher?: UrlMatcher,
    private readonly db?: DomainDatabase
  ) {
    const data = subresourceData as {
      tracking: string[];
      social: string[];
      functional: string[];
      functionalPaths: string[];
      neverBlock: string[];
    };
    this.tracking = data.tracking.map(parseEntry);
    this.social = data.social.map(parseEntry);
    this.functional = data.functional.map(parseEntry);
    this.functionalPaths = data.functionalPaths.map((p) => p.toLowerCase());
    this.neverBlock = data.neverBlock.map(parseEntry);
    this.allowlist = allowlist.map(parseEntry);

    const index = buildOwnershipIndex(db ?? getDomainDatabase());
    this.ownedHosts = index.hosts;
    this.ownedBrandTLDs = index.brandTLDs;
  }

  /** True when the host belongs to Google, regardless of user set choices. */
  isGoogleOwned(host: string): boolean {
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (this.ownedBrandTLDs.has(tld)) return true;
    // Walk suffixes from the TLD inwards, extending one growing string instead
    // of joining a fresh slice per label — this runs on every sub-resource of
    // every page, so per-label array copies add up.
    const labels = host.split('.');
    let suffix = labels[labels.length - 1] as string;
    for (let i = labels.length - 2; i >= 0; i--) {
      suffix = `${labels[i]}.${suffix}`;
      if (this.ownedHosts.has(suffix)) return true;
    }
    return false;
  }

  /** Classify a resource host and path without deciding what to do about it. */
  classify(host: string, path: string): { cls: ResourceClass; pattern?: string } {
    for (const entry of this.functional) {
      if (entryMatches(entry, host, path)) {
        return { cls: 'functional', pattern: entry.host + entry.path };
      }
    }
    for (const entry of this.tracking) {
      if (entryMatches(entry, host, path)) {
        return { cls: 'tracking', pattern: entry.host + entry.path };
      }
    }
    for (const entry of this.social) {
      if (entryMatches(entry, host, path)) {
        return { cls: 'social', pattern: entry.host + entry.path };
      }
    }
    return { cls: 'unknown' };
  }

  /**
   * Decide whether to allow or block one third-party Google sub-resource.
   *
   * Pure and synchronous, so the whole policy is covered by unit tests rather
   * than only observable by loading real websites.
   */
  decide(context: SubresourceContext): SubresourceDecision {
    if (this.mode === 'off') return ALLOW('blocking-disabled');

    // Document loads belong to the navigation engine, and cancelling a
    // stylesheet or font produces a visibly broken page.
    if (NEVER_BLOCK_TYPES.has(context.type)) return ALLOW(`type:${context.type}`);

    const target = safeParse(context.url);
    if (target === null) return ALLOW('unparseable-url');
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return ALLOW('unsupported-scheme');
    }

    const host = normalizeHostPattern(target.hostname);
    const path = target.pathname.toLowerCase();

    // Only Google resources are in scope. Ownership is checked against the
    // full database rather than the containerization matcher, which would hide
    // exactly the advertising hosts this feature exists to block.
    if (!this.isGoogleOwned(host)) return ALLOW('not-google');

    // No origin means the browser could not attribute the request. Blocking on
    // a guess risks breaking a page for no measurable gain.
    if (context.originUrl === null) return ALLOW('no-origin');

    const origin = safeParse(context.originUrl);
    if (origin === null) return ALLOW('unparseable-origin');
    const originHost = normalizeHostPattern(origin.hostname);

    // A Google page loading its own resources is first-party, not tracking.
    if (this.isGoogleOwned(originHost)) return ALLOW('google-first-party');
    if (sameSite(host, originHost)) return ALLOW('same-site');

    // Inside the container the request is already isolated, and the user has
    // deliberately entered a Google context.
    if (context.tabInContainer) return ALLOW('tab-in-container');

    // User allowlist: exempt a whole site the user has chosen to trust.
    for (const entry of this.allowlist) {
      if (hostMatches(originHost, entry.host)) {
        return {
          action: 'allow',
          resourceClass: 'unknown',
          reason: 'user-allowlist',
          pattern: entry.host,
        };
      }
    }

    // Never blocked in any mode. Removing these locks people out of accounts.
    for (const entry of this.neverBlock) {
      if (entryMatches(entry, host, path)) {
        return {
          action: 'allow',
          resourceClass: 'functional',
          reason: 'never-block',
          pattern: entry.host + entry.path,
        };
      }
    }

    // Load-bearing paths win over the host classification, so that
    // apis.google.com/js/api.js works while the rest of that host stays blocked.
    for (const prefix of this.functionalPaths) {
      if (path.startsWith(prefix) || path.includes(prefix)) {
        if (this.mode !== 'strict') {
          return {
            action: 'allow',
            resourceClass: 'functional',
            reason: 'functional-path',
            pattern: prefix,
          };
        }
      }
    }

    const { cls, pattern } = this.classify(host, path);

    if (cls === 'tracking' || cls === 'social') {
      return { action: 'block', resourceClass: cls, reason: `${cls}-resource`, pattern };
    }

    if (cls === 'functional') {
      if (this.mode === 'strict') {
        return { action: 'block', resourceClass: cls, reason: 'strict-mode', pattern };
      }
      return { action: 'allow', resourceClass: cls, reason: 'functional-resource', pattern };
    }

    // An unclassified Google host. Strict mode blocks it; standard mode allows
    // it, because guessing wrong breaks a page while the cookie compartment
    // already limits what it can learn.
    if (this.mode === 'strict') {
      return { action: 'block', resourceClass: 'unknown', reason: 'strict-unknown' };
    }
    return ALLOW('unclassified', 'unknown');
  }

  /**
   * Cached wrapper around decide(), for the hot request path.
   *
   * A fast path first replicates the cheap prefix of decide() for requests
   * that can only ever end in "not-google": most sub-resource loads on the web
   * are not Google-owned, and each one would otherwise pay for cache-key string
   * building, Map bookkeeping and a second URL parse inside decide(). The guard
   * order mirrors decide() exactly, so both paths always agree.
   */
  decideCached(context: SubresourceContext): SubresourceDecision {
    if (this.mode !== 'off' && !NEVER_BLOCK_TYPES.has(context.type)) {
      const parsed = safeParse(context.url);
      if (
        parsed !== null &&
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !this.isGoogleOwned(normalizeHostPattern(parsed.hostname))
      ) {
        return ALLOW('not-google');
      }
    }

    const key = `${context.originUrl ?? ''}\u0000${context.url}\u0000${context.type}\u0000${
      context.tabInContainer ? '1' : '0'
    }`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const decision = this.decide(context);
    // Evict the oldest entry rather than clearing everything: a full wipe at
    // the boundary would discard every warm decision mid-page-load.
    if (this.cache.size >= SubresourceClassifier.CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, decision);
    return decision;
  }

  counts(): Record<string, number> {
    return {
      tracking: this.tracking.length,
      social: this.social.length,
      functional: this.functional.length,
      neverBlock: this.neverBlock.length,
      allowlist: this.allowlist.length,
    };
  }
}
