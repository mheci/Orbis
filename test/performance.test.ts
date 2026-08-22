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
import { SubresourceClassifier } from '../src/core/subresource.js';
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

describe('cache eviction policy', () => {
  it('evicts the oldest matcher entry instead of wiping the cache', () => {
    const matcher = new UrlMatcher(makeSettings());
    for (let i = 0; i < 512; i++) matcher.match(`https://example.com/${i}`);
    matcher.match('https://fresh.example.com/'); // pushes size over the limit
    const cache = (matcher as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBe(512);
    expect(cache.has('https://example.com/0')).toBe(false); // oldest gone
    expect(cache.has('https://example.com/511')).toBe(true); // warm kept
    expect(cache.has('https://fresh.example.com/')).toBe(true); // newest kept
  });

  it('evicts the oldest classifier entry instead of wiping the cache', () => {
    const classifier = new SubresourceClassifier('standard');
    const context = (url: string) => ({
      url,
      originUrl: 'https://news.example.com/',
      type: 'script',
      tabInContainer: false,
    });
    // Google-owned hosts exercise the cached path.
    for (let i = 0; i < 1024; i++) {
      classifier.decideCached(context(`https://www.gstatic.com/a${i}.js`));
    }
    classifier.decideCached(context('https://www.gstatic.com/new.js'));
    const cache = (classifier as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBe(1024);
    const keys = [...cache.keys()];
    expect(keys.some((k) => k.includes('a0.js'))).toBe(false); // oldest evicted
    expect(keys.some((k) => k.includes('a1023.js'))).toBe(true); // warm kept
  });
});

describe('subresource fast path', () => {
  const ORIGIN = 'https://news.example.com/story';
  const contexts = [
    {
      url: 'https://counter.example.com/pixel.gif',
      originUrl: ORIGIN,
      type: 'image',
      tabInContainer: false,
    },
    {
      url: 'https://www.google-analytics.com/analytics.js',
      originUrl: ORIGIN,
      type: 'script',
      tabInContainer: false,
    },
    {
      url: 'https://fonts.googleapis.com/css?family=x',
      originUrl: ORIGIN,
      type: 'stylesheet',
      tabInContainer: false,
    },
    {
      url: 'https://apis.google.com/js/api.js',
      originUrl: ORIGIN,
      type: 'script',
      tabInContainer: false,
    },
    {
      url: 'https://accounts.google.com/o/oauth2/auth',
      originUrl: ORIGIN,
      type: 'xmlhttprequest',
      tabInContainer: false,
    },
    {
      url: 'https://www.youtube.com/embed/x',
      originUrl: ORIGIN,
      type: 'sub_frame',
      tabInContainer: true,
    },
    {
      url: 'ftp://files.example.com/data',
      originUrl: ORIGIN,
      type: 'object',
      tabInContainer: false,
    },
    { url: '::not-a-url::', originUrl: null, type: 'other', tabInContainer: false },
  ];

  it.each(['off', 'standard', 'strict'] as const)(
    'decideCached agrees with decide() in %s mode',
    (mode) => {
      const classifier = new SubresourceClassifier(mode);
      for (const context of contexts) {
        expect(classifier.decideCached(context)).toEqual(classifier.decide(context));
      }
    }
  );

  it('returns not-google for non-owned hosts without touching the cache', () => {
    const classifier = new SubresourceClassifier('standard');
    const decision = classifier.decideCached({
      url: 'https://counter.example.com/pixel.gif',
      originUrl: 'https://news.example.com/story',
      type: 'image',
      tabInContainer: false,
    });
    expect(decision).toEqual({
      action: 'allow',
      resourceClass: 'unknown',
      reason: 'not-google',
    });
    const cache = (classifier as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBe(0);
  });

  it('classifies very long host chains without allocations blowups', () => {
    const classifier = new SubresourceClassifier('standard');
    const deepHost = `${Array.from({ length: 40 }, (_, i) => `lvl${i}`).join('.')}.example.com`;
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      classifier.decideCached({
        url: `https://${deepHost}/p${i}`,
        originUrl: ORIGIN,
        type: 'image',
        tabInContainer: false,
      });
    }
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
