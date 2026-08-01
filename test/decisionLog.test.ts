/**
 * Decision log tests — the bounded local record of what the engine decided.
 */

import { describe, expect, it } from 'vitest';
import type { NavigationAction } from '../src/core/decision.js';
import {
  DECISION_LOG_CAPACITY,
  DECISION_LOG_URL_LIMIT,
  DecisionLog,
  makeDecisionEntry,
  shouldLogDecision,
} from '../src/core/decisionLog.js';

const contain: NavigationAction = {
  kind: 'contain',
  url: 'https://mail.google.com/',
  cookieStoreId: 'firefox-container-7',
  replaceTabId: 1,
  reason: 'match:domain-set',
};

describe('shouldLogDecision', () => {
  it('logs every action taken', () => {
    expect(shouldLogDecision(contain)).toBe(true);
    expect(
      shouldLogDecision({
        kind: 'release',
        url: 'https://example.com/',
        replaceTabId: 1,
        reason: 'non-google-in-container',
      })
    ).toBe(true);
    expect(
      shouldLogDecision({
        kind: 'unwrap',
        url: 'https://example.com/',
        targetOutside: true,
        replaceTabId: 1,
        reason: 'redirector',
      })
    ).toBe(true);
  });

  it('filters out the routine ignores', () => {
    expect(shouldLogDecision({ kind: 'ignore', reason: 'not-google' })).toBe(false);
    expect(shouldLogDecision({ kind: 'ignore', reason: 'already-contained' })).toBe(false);
  });

  it('keeps ignores that explain something', () => {
    for (const reason of [
      'loop-guard',
      'protection-inactive',
      'never-list',
      'exception',
      'container-unavailable',
    ]) {
      expect(shouldLogDecision({ kind: 'ignore', reason })).toBe(true);
    }
  });
});

describe('makeDecisionEntry', () => {
  it('extracts the host and keeps the full URL when short', () => {
    const entry = makeDecisionEntry(contain, 'https://mail.google.com/inbox', 7, 1000);
    expect(entry.host).toBe('mail.google.com');
    expect(entry.url).toBe('https://mail.google.com/inbox');
    expect(entry.kind).toBe('contain');
    expect(entry.reason).toBe('match:domain-set');
    expect(entry.tabId).toBe(7);
    expect(entry.at).toBe(1000);
  });

  it('truncates very long URLs and records a null host when unparseable', () => {
    const long = `${'https://example.com/'.padEnd(DECISION_LOG_URL_LIMIT + 50, 'a')}`;
    const entry = makeDecisionEntry({ kind: 'ignore', reason: 'unsupported-scheme' }, long, 1, 0);
    expect(entry.url.length).toBeLessThanOrEqual(DECISION_LOG_URL_LIMIT + 1);
    expect(entry.url.endsWith('\u2026')).toBe(true);
    expect(entry.host).toBe('example.com');

    const weird = makeDecisionEntry({ kind: 'ignore', reason: 'x' }, 'not a url', 1, 0);
    expect(weird.host).toBeNull();
  });
});

describe('DecisionLog ring buffer', () => {
  it('returns entries oldest first', () => {
    const log = new DecisionLog();
    log.record(makeDecisionEntry(contain, 'https://a.example/', 1, 10));
    log.record(makeDecisionEntry(contain, 'https://b.example/', 1, 20));
    expect(log.size).toBe(2);
    expect(log.snapshot().map((e) => e.host)).toEqual(['a.example', 'b.example']);
  });

  it('drops the oldest entries once over capacity', () => {
    const log = new DecisionLog();
    for (let i = 0; i < DECISION_LOG_CAPACITY + 10; i++) {
      log.record(makeDecisionEntry(contain, `https://h${i}.example/`, 1, i));
    }
    expect(log.size).toBe(DECISION_LOG_CAPACITY);
    expect(log.snapshot()[0]!.host).toBe('h10.example');
    expect(log.snapshot()[log.snapshot().length - 1]!.host).toBe('h209.example');
  });

  it('clear empties the log', () => {
    const log = new DecisionLog();
    log.record(makeDecisionEntry(contain, 'https://a.example/', 1, 0));
    log.clear();
    expect(log.size).toBe(0);
    expect(log.snapshot()).toEqual([]);
  });

  it('restore accepts valid entries and discards garbage', () => {
    const log = new DecisionLog();
    log.restore([
      {
        at: 1,
        kind: 'contain',
        reason: 'match:domain-set',
        url: 'https://a.example/',
        tabId: 1,
        host: 'a.example',
      },
      { at: 2, kind: 'bogus', reason: 'x', url: 'https://b.example/', tabId: 1, host: 'b.example' },
      'nope',
      null,
      {
        at: 3,
        kind: 'ignore',
        reason: 'loop-guard',
        url: 'https://c.example/',
        tabId: 1,
        host: null,
      },
      { at: 4, kind: 'release', reason: 'y', url: 'https://d.example/', tabId: 1 },
    ]);
    expect(log.size).toBe(2);
    expect(log.snapshot().map((e) => e.host)).toEqual(['a.example', null]);
  });

  it('restore caps oversized payloads and tolerates non-arrays', () => {
    const log = new DecisionLog();
    log.restore({ not: 'an array' });
    expect(log.size).toBe(0);
    const oversized = Array.from({ length: DECISION_LOG_CAPACITY + 5 }, (_, i) => ({
      at: i,
      kind: 'ignore' as const,
      reason: 'loop-guard',
      url: `https://h${i}.example/`,
      tabId: 1,
      host: `h${i}.example`,
    }));
    log.restore(oversized);
    expect(log.size).toBe(DECISION_LOG_CAPACITY);
    expect(log.snapshot()[0]!.host).toBe('h5.example');
  });
});
