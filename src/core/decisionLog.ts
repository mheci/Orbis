/**
 * Decision log — a bounded, pure record of what the engine decided.
 *
 * `decideNavigation` stays side-effect free; the background adapter feeds this
 * log instead. Entries are kept in a ring buffer (oldest dropped first) and can
 * be restored from storage, so the options page can explain "why did this
 * navigation move / not move" without any network or privacy exposure.
 */

import type { NavigationAction } from './decision.js';
import { safeParse } from './matcher.js';
import type { DecisionEntry } from '../types/index.js';

/** How many decisions the log keeps at most. */
export const DECISION_LOG_CAPACITY = 200;
/** URLs longer than this are truncated; every full URL still lives in history. */
export const DECISION_LOG_URL_LIMIT = 200;

/**
 * Ignores that happen for the most common, least interesting reasons. Logging
 * every untouched non-Google navigation would drown the useful entries.
 */
const ROUTINE_IGNORES = new Set(['not-google', 'already-contained']);

/** True when a decision is worth keeping in the log. */
export function shouldLogDecision(action: NavigationAction): boolean {
  return action.kind !== 'ignore' || !ROUTINE_IGNORES.has(action.reason);
}

/** Build a log entry from an engine decision, truncating the URL. */
export function makeDecisionEntry(
  action: NavigationAction,
  url: string,
  tabId: number,
  now: number
): DecisionEntry {
  const parsed = safeParse(url);
  const truncated =
    url.length <= DECISION_LOG_URL_LIMIT ? url : `${url.slice(0, DECISION_LOG_URL_LIMIT)}\u2026`;
  return {
    at: now,
    kind: action.kind,
    reason: action.reason,
    url: truncated,
    tabId,
    host: parsed?.hostname ?? null,
  };
}

/** Bounded in-memory decision history, oldest entries dropped first. */
export class DecisionLog {
  private readonly entries: DecisionEntry[] = [];

  /** Add one entry, dropping the oldest when at capacity. */
  record(entry: DecisionEntry): void {
    this.entries.push(entry);
    if (this.entries.length > DECISION_LOG_CAPACITY) {
      this.entries.splice(0, this.entries.length - DECISION_LOG_CAPACITY);
    }
  }

  /** All entries, oldest first. */
  snapshot(): DecisionEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }

  /**
   * Replace the log with validated entries read from storage. Anything that
   * does not look like a real entry is discarded, so a corrupted value can
   * never crash the worker or the options page.
   */
  restore(raw: unknown): void {
    this.clear();
    if (!Array.isArray(raw)) return;
    const KINDS = new Set<DecisionEntry['kind']>(['contain', 'release', 'unwrap', 'ignore']);
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate['at'] !== 'number' ||
        typeof candidate['tabId'] !== 'number' ||
        typeof candidate['reason'] !== 'string' ||
        typeof candidate['url'] !== 'string' ||
        !KINDS.has(candidate['kind'] as DecisionEntry['kind']) ||
        !(typeof candidate['host'] === 'string' || candidate['host'] === null)
      ) {
        continue;
      }
      this.entries.push({
        at: candidate['at'],
        kind: candidate['kind'] as DecisionEntry['kind'],
        reason: candidate['reason'],
        url: candidate['url'],
        tabId: candidate['tabId'],
        host: candidate['host'],
      });
    }
    if (this.entries.length > DECISION_LOG_CAPACITY) {
      this.entries.splice(0, this.entries.length - DECISION_LOG_CAPACITY);
    }
  }

  get size(): number {
    return this.entries.length;
  }
}
