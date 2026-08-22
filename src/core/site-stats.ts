/**
 * Per-site activity counters — strictly local analytics.
 *
 * The aggregate statistics answer "how much"; this table answers "where".
 * Every entry is a hostname plus four counters and a last-seen instant. No
 * URLs, no page titles, no history — a site either happened or it did not.
 *
 * Storage discipline:
 *  - bounded at SITE_STATS_CAPACITY hosts, evicted least-recently-seen first;
 *  - never synced (it lives outside the Settings document), never exported in
 *    backups, dropped wholesale by "Clear statistics";
 *  - recording only happens while `behaviour.collectStatistics` is enabled,
 *    checked by the caller like every other counter.
 */

import type { SiteStatEntry } from '../types/index.js';

/** Maximum number of sites remembered. */
export const SITE_STATS_CAPACITY = 200;

/** Mirrors the strict host syntax enforced for user rules in matcher.ts. */
const HOST_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

type StatKind = 'contained' | 'released' | 'unwrapped' | 'trackersBlocked';

interface MutableEntry {
  contained: number;
  released: number;
  unwrapped: number;
  trackersBlocked: number;
  lastSeen: number;
}

function emptyEntry(now: number): MutableEntry {
  return { contained: 0, released: 0, unwrapped: 0, trackersBlocked: 0, lastSeen: now };
}

/** Bounded, validated per-host counters with least-recently-seen eviction. */
export class SiteStats {
  /**
   * Insertion order == most-recently-seen order, because every record()
   * re-inserts its host. The head of the map is therefore the next eviction.
   */
  private readonly entries = new Map<string, MutableEntry>();

  /** Record one event for `host` at instant `now`. */
  record(kind: StatKind, host: string, now: number): void {
    const normalized = host.trim().toLowerCase();
    if (!HOST_PATTERN.test(normalized)) return;
    let entry = this.entries.get(normalized);
    if (entry === undefined) {
      entry = emptyEntry(now);
      this.entries.set(normalized, entry);
      this.evict();
    }
    entry[kind] += 1;
    entry.lastSeen = now;
    // Refresh recency ordering (Map iteration order is insertion order).
    this.entries.delete(normalized);
    this.entries.set(normalized, entry);
  }

  /** All entries, most recently seen first. */
  snapshot(): SiteStatEntry[] {
    const all = [...this.entries.entries()];
    all.sort((a, b) => b[1].lastSeen - a[1].lastSeen);
    return all.map(([host, e]) => ({
      host,
      contained: e.contained,
      released: e.released,
      unwrapped: e.unwrapped,
      trackersBlocked: e.trackersBlocked,
      lastSeen: e.lastSeen,
    }));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Replace the table with validated entries read from storage. Anything that
   * does not look like a real entry is discarded, so corrupted storage can
   * never surface in the UI or crash the worker.
   */
  restore(raw: unknown): void {
    this.clear();
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as Record<string, unknown>;
      const host = candidate['host'];
      if (typeof host !== 'string' || !HOST_PATTERN.test(host)) continue;
      const entry = emptyEntry(0);
      let anyValue = false;
      for (const kind of ['contained', 'released', 'unwrapped', 'trackersBlocked'] as const) {
        const value = candidate[kind];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          entry[kind] = Math.floor(value);
          anyValue ||= entry[kind] > 0;
        }
      }
      if (
        typeof candidate['lastSeen'] === 'number' &&
        Number.isFinite(candidate['lastSeen']) &&
        candidate['lastSeen'] >= 0
      ) {
        entry.lastSeen = candidate['lastSeen'];
        anyValue = true;
      }
      // Skip rows that carry no information at all.
      if (!anyValue && entry.lastSeen === 0) continue;
      this.entries.set(host, entry);
      this.evict();
    }
  }

  private evict(): void {
    while (this.entries.size > SITE_STATS_CAPACITY) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
