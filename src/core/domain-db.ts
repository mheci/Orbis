/**
 * Domain database loader.
 *
 * The JSON files under `src/domains/` are the single source of truth for which
 * hosts belong to Google. They are imported at build time (esbuild inlines
 * them), so there is no runtime fetch, no remote code and no I/O on startup.
 *
 * Adding a domain is therefore a pure data change: edit JSON, run the tests.
 */

import googleSet from '../domains/google.json';
import youtubeSet from '../domains/youtube.json';
import ccTLDSet from '../domains/ccTLD.json';
import aliasSet from '../domains/aliases.json';
import trackerSet from '../domains/trackers.json';
import hostingSet from '../domains/hosting.json';

/** A redirector definition: host + path whose query parameter holds a real URL. */
export interface RedirectorRule {
  readonly host: string;
  readonly path: string;
  readonly params: readonly string[];
}

/** One logical group of domains that the user can switch on or off. */
export interface DomainSet {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Whether the set participates in matching unless the user says otherwise. */
  readonly defaultEnabled: boolean;
  /** Fully expanded, lower-case, punycode-ready host suffixes. */
  readonly hosts: readonly string[];
}

export interface DomainDatabase {
  readonly sets: readonly DomainSet[];
  /** Brand gTLD labels (e.g. "google") that make any host under them Google-owned. */
  readonly brandTLDs: readonly string[];
  readonly redirectors: readonly RedirectorRule[];
  /** host+path prefixes that must never be containerized (federated widgets). */
  readonly builtinNever: readonly string[];
  /** Path fragments that indicate a third-party OAuth handshake. */
  readonly oauthPaths: readonly string[];
  /** Total number of distinct host suffixes across all sets. */
  readonly hostCount: number;
}

/** Normalise a host suffix: lower case, strip leading dots and "*." wildcards. */
export function normalizeHostPattern(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  while (host.startsWith('.')) host = host.slice(1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * Expand `bases` x `suffixes` into concrete registrable domains.
 * e.g. ["google"] x ["co.uk","de"] -> ["google.co.uk", "google.de"].
 */
export function expandCcTLDs(bases: readonly string[], suffixes: readonly string[]): string[] {
  const out: string[] = [];
  for (const base of bases) {
    const b = normalizeHostPattern(base);
    if (!b) continue;
    for (const suffix of suffixes) {
      const s = normalizeHostPattern(suffix);
      if (!s) continue;
      out.push(`${b}.${s}`);
    }
  }
  return out;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeHostPattern).filter((v) => v.length > 0))].sort();
}

/** Build the immutable in-memory domain database. Called once per worker start. */
export function buildDomainDatabase(): DomainDatabase {
  const suffixes = ccTLDSet.suffixes as readonly string[];
  const brandTLDs = dedupe(ccTLDSet.brandTLDs as readonly string[]);

  // Core Google set: literal domains + .google gTLD hosts + expanded ccTLDs.
  const coreCcTLDs = expandCcTLDs(
    (ccTLDSet.bases as readonly string[]).filter((b) => b !== 'youtube'),
    suffixes
  );
  const core = dedupe([
    ...(googleSet.domains as readonly string[]),
    ...(googleSet.gtldDomains as readonly string[]),
    ...coreCcTLDs,
  ]);

  // YouTube set: literal domains + youtube ccTLDs + .youtube gTLD hosts.
  const youtubeCcTLDs = expandCcTLDs((youtubeSet.ccTLDBases as readonly string[]) ?? [], suffixes);
  const youtube = dedupe([
    ...(youtubeSet.domains as readonly string[]),
    ...(youtubeSet.gtldDomains as readonly string[]),
    ...youtubeCcTLDs,
  ]);

  const trackers = dedupe(trackerSet.domains as readonly string[]);
  const hosting = dedupe(hostingSet.domains as readonly string[]);

  const sets: DomainSet[] = [
    {
      id: 'google',
      title: googleSet.title,
      description: googleSet.description,
      defaultEnabled: true,
      hosts: core,
    },
    {
      id: 'youtube',
      title: youtubeSet.title,
      description: youtubeSet.description,
      defaultEnabled: true,
      hosts: youtube,
    },
    {
      id: 'trackers',
      title: trackerSet.title,
      description: trackerSet.description,
      defaultEnabled: trackerSet.defaultEnabled === true,
      hosts: trackers,
    },
    {
      id: 'hosting',
      title: hostingSet.title,
      description: hostingSet.description,
      defaultEnabled: hostingSet.defaultEnabled === true,
      hosts: hosting,
    },
  ];

  const hostCount = new Set(sets.flatMap((s) => s.hosts)).size;

  return {
    sets,
    brandTLDs,
    redirectors: (aliasSet.redirectors as readonly RedirectorRule[]).filter(
      (r) => r.params.length > 0
    ),
    builtinNever: (aliasSet.neverContainerize as readonly string[]).map((p) =>
      p.trim().toLowerCase()
    ),
    oauthPaths: (aliasSet.oauthPaths as readonly string[]).map((p) => p.toLowerCase()),
    hostCount,
  };
}

/** Lazily-created singleton so repeated imports share one build. */
let cached: DomainDatabase | null = null;
export function getDomainDatabase(): DomainDatabase {
  if (cached === null) cached = buildDomainDatabase();
  return cached;
}

/** Test helper: drop the singleton. */
export function resetDomainDatabase(): void {
  cached = null;
}
