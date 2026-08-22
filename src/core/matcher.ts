/**
 * URL matching engine.
 *
 * Design goals
 * ------------
 * - Deterministic: the same URL always yields the same decision.
 * - Fast: matching is O(number of labels in the host), not O(number of rules).
 *   A reverse-label trie is built once; lookups walk at most ~5 nodes.
 * - Safe: matching is done on the parsed URL's host, never on the raw string,
 *   so `https://evil.com/?x=google.com` and `https://google.com.evil.com` are
 *   correctly treated as non-Google.
 *
 * Precedence (highest first)
 * --------------------------
 *  1. user "never containerize" list      -> not Google
 *  2. time-boxed temporary allowances     -> not Google (until they expire)
 *  3. user exceptions (enabled only)      -> not Google
 *  4. built-in never list (GSI widgets)   -> not Google
 *  5. user "always containerize" list     -> Google
 *  6. brand gTLD (.google, .youtube, ...) -> Google
 *  7. enabled domain sets                 -> Google
 *  8. otherwise                           -> not Google
 */

import type { ExceptionRule, MatchResult, Settings } from '../types/index.js';
import { getDomainDatabase, normalizeHostPattern, type DomainDatabase } from './domain-db.js';

const NO_MATCH: MatchResult = { isGoogle: false, source: 'none' };

/** Schemes we are willing to containerize. Everything else is ignored. */
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Set when a host suffix terminates here. Holds the source label. */
  terminal?: { pattern: string; setId: string };
}

function createNode(): TrieNode {
  return { children: new Map() };
}

function insert(root: TrieNode, host: string, setId: string): void {
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return;
  let node = root;
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i] as string;
    let next = node.children.get(label);
    if (next === undefined) {
      next = createNode();
      node.children.set(label, next);
    }
    node = next;
  }
  // Keep the first insertion so precedence between sets is stable.
  if (node.terminal === undefined) node.terminal = { pattern: host, setId };
}

/**
 * Walk the trie from the public suffix inwards.
 * Returns the matched terminal if `host` equals or is a subdomain of a pattern.
 */
function lookup(root: TrieNode, host: string): { pattern: string; setId: string } | null {
  const labels = host.split('.').filter(Boolean);
  let node = root;
  let best: { pattern: string; setId: string } | null = null;
  for (let i = labels.length - 1; i >= 0; i--) {
    const next = node.children.get(labels[i] as string);
    if (next === undefined) break;
    node = next;
    if (node.terminal !== undefined) best = node.terminal;
  }
  return best;
}

/** Parsed representation of a user-supplied rule ("host" or "host/path"). */
interface HostPathRule {
  readonly host: string;
  readonly path: string;
  readonly raw: string;
}

/**
 * Strict host syntax: dot-separated LDH labels only.
 * This is what stops values like `javascript:alert(1)`, `evil.com:8080/x` or
 * `../../etc` from ever being accepted as a user rule.
 */
const HOST_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function parseHostPathRule(raw: string): HostPathRule | null {
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return null;
  // Tolerate users pasting full URLs.
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^\*\./, '');
  // Strip credentials and any query/fragment; only host + path are meaningful.
  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);
  value = value.split('?')[0] as string;
  value = value.split('#')[0] as string;

  const slash = value.indexOf('/');
  let hostPart = slash === -1 ? value : value.slice(0, slash);
  // Drop an explicit port: rules are per-host, not per-port.
  const colon = hostPart.indexOf(':');
  if (colon !== -1) hostPart = hostPart.slice(0, colon);

  const host = normalizeHostPattern(hostPart);
  if (!HOST_PATTERN.test(host)) return null;

  // A bare "/" carries no information, so normalise it away. This keeps
  // "example.com" and "https://example.com/" canonically identical.
  let path = slash === -1 ? '' : value.slice(slash);
  if (path === '/') path = '';
  return { host, path, raw };
}

/** True when `host` equals `rule.host` or is one of its subdomains. */
function hostMatches(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

function ruleMatches(rule: HostPathRule, host: string, pathname: string): boolean {
  if (!hostMatches(host, rule.host)) return false;
  if (rule.path === '') return true;
  return pathname.toLowerCase().startsWith(rule.path);
}

/** A compiled temporary allowance: a host rule plus its expiry instant. */
interface TemporaryRule {
  readonly rule: HostPathRule;
  readonly until: number;
}

/**
 * A compiled, immutable matcher. Rebuilt whenever settings change; building is
 * cheap (a few milliseconds for ~1000 hosts) and happens off the hot path.
 */
export class UrlMatcher {
  private readonly trie: TrieNode = createNode();
  private readonly brandTLDs: ReadonlySet<string>;
  private readonly builtinNever: readonly HostPathRule[];
  private readonly alwaysRules: readonly HostPathRule[];
  private readonly neverRules: readonly HostPathRule[];
  private readonly exceptionRules: readonly HostPathRule[];
  private readonly temporaryRules: readonly TemporaryRule[];
  private readonly oauthPaths: readonly string[];
  /** Small LRU-ish cache keyed by origin+path prefix. */
  private readonly cache = new Map<string, MatchResult>();
  private static readonly CACHE_LIMIT = 512;

  readonly buildMs: number;
  readonly hostCount: number;

  constructor(
    settings: Settings,
    private readonly db: DomainDatabase = getDomainDatabase()
  ) {
    const started = Date.now();

    for (const set of db.sets) {
      const enabled = settings.domainSets[set.id] ?? set.defaultEnabled;
      if (!enabled) continue;
      for (const host of set.hosts) insert(this.trie, host, set.id);
    }

    this.brandTLDs = new Set(db.brandTLDs);
    this.oauthPaths = db.oauthPaths;
    this.builtinNever = db.builtinNever
      .map(parseHostPathRule)
      .filter((r): r is HostPathRule => r !== null);
    this.alwaysRules = compileList(settings.alwaysContainerize);
    this.neverRules = compileList(settings.neverContainerize);
    this.exceptionRules = compileExceptions(settings.exceptions);
    this.temporaryRules = settings.temporaryAllowances
      .map((entry) => {
        const rule = parseHostPathRule(entry.pattern);
        return rule === null ? null : { rule, until: entry.until };
      })
      .filter((r): r is TemporaryRule => r !== null);

    this.hostCount = db.hostCount;
    this.buildMs = Date.now() - started;
  }

  /** Decide whether a URL belongs in the Google container. */
  match(url: string): MatchResult {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;
    const result = this.computeMatch(url);
    // Time-boxed verdicts are never cached: the cache has no clock, and a
    // stored "temporarily allowed" answer could otherwise outlive its window
    // until an unrelated settings write rebuilt the matcher. Recomputing them
    // costs one trie walk per navigation while the window is live.
    if (result.source !== 'temporary-allow') {
      // Evict the oldest entry instead of wiping the whole cache: a full clear
      // at the size boundary would throw away every warm entry during exactly
      // the navigation bursts the cache exists for.
      if (this.cache.size >= UrlMatcher.CACHE_LIMIT) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(url, result);
    }
    return result;
  }

  private computeMatch(url: string): MatchResult {
    const parsed = safeParse(url);
    if (parsed === null) return NO_MATCH;
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) return NO_MATCH;

    const host = normalizeHostPattern(parsed.hostname);
    if (host.length === 0) return NO_MATCH;
    const pathname = parsed.pathname;

    // 1. Explicit user "never" wins over everything.
    for (const rule of this.neverRules) {
      if (ruleMatches(rule, host, pathname)) {
        return { isGoogle: false, source: 'never-list', pattern: rule.raw };
      }
    }

    // 2. Time-boxed temporary allowances. Checked against the clock, never
    //    against a timer, so a suspended worker cannot keep one alive past its
    //    expiry — the worst a stale cache entry can do is expire one hop late.
    const now = Date.now();
    for (const { rule, until } of this.temporaryRules) {
      if (until <= now) continue;
      if (ruleMatches(rule, host, pathname)) {
        return { isGoogle: false, source: 'temporary-allow', pattern: rule.raw };
      }
    }

    // 2. User exceptions.
    for (const rule of this.exceptionRules) {
      if (ruleMatches(rule, host, pathname)) {
        return { isGoogle: false, source: 'exception', pattern: rule.raw };
      }
    }

    // 3. Built-in never list (federated sign-in widgets embedded by others).
    for (const rule of this.builtinNever) {
      if (ruleMatches(rule, host, pathname)) {
        return { isGoogle: false, source: 'builtin-never', pattern: rule.raw };
      }
    }

    // 4. User "always".
    for (const rule of this.alwaysRules) {
      if (ruleMatches(rule, host, pathname)) {
        return { isGoogle: true, source: 'always-list', pattern: rule.raw };
      }
    }

    // 5. Brand gTLDs: any host ending in .google / .youtube / ... is Google.
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (this.brandTLDs.has(tld)) {
      return { isGoogle: true, source: 'brand-tld', pattern: `.${tld}` };
    }

    // 6. Domain-set trie.
    const hit = lookup(this.trie, host);
    if (hit !== null) {
      const source =
        hit.pattern.startsWith('google.') || hit.pattern.startsWith('youtube.')
          ? 'cctld'
          : 'domain-set';
      return { isGoogle: true, source, pattern: hit.pattern };
    }

    return NO_MATCH;
  }

  /** True when the URL looks like a third-party OAuth handshake endpoint. */
  isOAuthEndpoint(url: string): boolean {
    const parsed = safeParse(url);
    if (parsed === null) return false;
    const host = normalizeHostPattern(parsed.hostname);
    if (host !== 'accounts.google.com' && host !== 'accounts.youtube.com') return false;
    const path = parsed.pathname.toLowerCase();
    return this.oauthPaths.some((p) => path.startsWith(p) || path.includes(p));
  }

  /**
   * Resolve a Google redirector URL (google.com/url?q=..., youtube.com/redirect?q=...)
   * to the external destination it points at. Returns null when the URL is not a
   * redirector, the parameter is missing, or the destination is itself Google.
   */
  unwrapRedirector(url: string): string | null {
    const parsed = safeParse(url);
    if (parsed === null) return null;
    const host = normalizeHostPattern(parsed.hostname);
    const path = parsed.pathname;

    for (const rule of this.db.redirectors) {
      if (rule.params.length === 0) continue;
      if (!hostMatches(host, rule.host)) continue;
      if (rule.path !== '' && path !== rule.path) continue;
      for (const param of rule.params) {
        const raw = parsed.searchParams.get(param);
        if (raw === null || raw.length === 0) continue;
        const target = safeParse(raw);
        if (target === null) continue;
        if (!SUPPORTED_PROTOCOLS.has(target.protocol)) continue;
        if (this.match(target.href).isGoogle) continue;
        return target.href;
      }
    }
    return null;
  }

  /** Diagnostics helper. */
  ruleCounts(): Record<string, number> {
    return {
      always: this.alwaysRules.length,
      never: this.neverRules.length,
      exceptions: this.exceptionRules.length,
      temporary: this.temporaryRules.length,
      builtinNever: this.builtinNever.length,
      brandTLDs: this.brandTLDs.size,
      hosts: this.hostCount,
    };
  }
}

function compileList(values: readonly string[]): HostPathRule[] {
  return values.map(parseHostPathRule).filter((r): r is HostPathRule => r !== null);
}

function compileExceptions(values: readonly ExceptionRule[]): HostPathRule[] {
  return values
    .filter((e) => e.enabled)
    .map((e) => parseHostPathRule(e.pattern))
    .filter((r): r is HostPathRule => r !== null);
}

/** URL parsing that never throws. */
export function safeParse(url: string): URL | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
