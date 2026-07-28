/**
 * Performance guard rails.
 *
 * These budgets are deliberately generous (CI machines are noisy) but tight
 * enough to catch an accidental O(n) regression in the hot path — e.g. someone
 * replacing the trie with a linear scan over ~700 host patterns.
 */

import { describe, expect, it } from 'vitest';
import { UrlMatcher } from '../src/core/matcher.js';
import { LoopGuard } from '../src/core/decision.js';
import { makeSettings } from './helpers.js';

describe('matcher performance', () => {
  it('builds in a few milliseconds', () => {
    const started = performance.now();
    const matcher = new UrlMatcher(makeSettings());
    const elapsed = performance.now() - started;
    expect(matcher.ruleCounts().hosts).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(150);
  });

  it('matches 50k URLs quickly', () => {
    const matcher = new UrlMatcher(makeSettings());
    const urls = [
      'https://www.google.com/search?q=a',
      'https://mail.google.com/mail/u/0',
      'https://example.com/page',
      'https://www.youtube.com/watch?v=x',
      'https://news.ycombinator.com/',
    ];
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      for (const url of urls) matcher.match(`${url}#${i}`);
    }
    const elapsed = performance.now() - started;
    // 50k unique URLs; anything over ~2s means the hot path degraded badly.
    expect(elapsed).toBeLessThan(2000);
  });

  it('serves repeated lookups from cache', () => {
    const matcher = new UrlMatcher(makeSettings());
    const url = 'https://mail.google.com/mail/u/0';
    matcher.match(url);
    const started = performance.now();
    for (let i = 0; i < 100_000; i++) matcher.match(url);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('keeps the match cache bounded', () => {
    const matcher = new UrlMatcher(makeSettings());
    for (let i = 0; i < 5000; i++) matcher.match(`https://example.com/${i}`);
    // Internal cache is capped at 512 entries; if it were unbounded, memory in a
    // long browsing session would grow without limit.
    const cache = (matcher as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBeLessThanOrEqual(512);
  });

  it('scales with many user rules', () => {
    const rules = Array.from({ length: 1000 }, (_, i) => `host${i}.example.com`);
    const matcher = new UrlMatcher(makeSettings({ neverContainerize: rules }));
    const started = performance.now();
    for (let i = 0; i < 2000; i++) matcher.match(`https://www.google.com/?i=${i}`);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('loop guard performance and memory', () => {
  it('stays bounded under heavy churn', () => {
    const guard = new LoopGuard(3000, 500);
    const started = performance.now();
    for (let i = 0; i < 50_000; i++) {
      guard.remember(i % 200, `https://example.com/${i}`, i);
      guard.isRepeat(i % 200, `https://example.com/${i}`, i);
    }
    expect(performance.now() - started).toBeLessThan(2000);
    expect(guard.size).toBeLessThanOrEqual(1000);
  });
});
