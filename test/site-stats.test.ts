/**
 * Per-site statistics recorder — the pure core behind "Activity by site".
 *
 * Covers: counting, recency ordering, bounded eviction of least-recently-seen
 * hosts, and hostile/corrupt restore payloads.
 */

import { describe, expect, it } from 'vitest';
import { SITE_STATS_CAPACITY, SiteStats } from '../src/core/site-stats.js';

describe('SiteStats', () => {
  it('counts each kind per host', () => {
    const stats = new SiteStats();
    stats.record('contained', 'mail.google.com', 1000);
    stats.record('contained', 'mail.google.com', 2000);
    stats.record('trackersBlocked', 'news.example.com', 3000);
    const snapshot = stats.snapshot();
    expect(stats.size).toBe(2);
    expect(snapshot).toEqual([
      {
        host: 'news.example.com',
        contained: 0,
        released: 0,
        unwrapped: 0,
        trackersBlocked: 1,
        lastSeen: 3000,
      },
      {
        host: 'mail.google.com',
        contained: 2,
        released: 0,
        unwrapped: 0,
        trackersBlocked: 0,
        lastSeen: 2000,
      },
    ]);
  });

  it('normalises host case and whitespace', () => {
    const stats = new SiteStats();
    stats.record('contained', '  Mail.GooGle.com ', 1);
    expect(stats.snapshot()[0]!.host).toBe('mail.google.com');
  });

  it('rejects hosts that are not plain hostnames', () => {
    const stats = new SiteStats();
    for (const bad of ['https://evil.com', '', 'not a host', '-lead.ing.com', 'trail-.com']) {
      stats.record('contained', bad, 1);
    }
    expect(stats.size).toBe(0);
  });

  it('orders the snapshot most recently seen first', () => {
    const stats = new SiteStats();
    stats.record('contained', 'a.example.com', 100);
    stats.record('released', 'b.example.com', 200);
    stats.record('unwrapped', 'a.example.com', 300);
    expect(stats.snapshot().map((e) => e.host)).toEqual(['a.example.com', 'b.example.com']);
  });

  it('evicts the least recently seen host beyond capacity', () => {
    const stats = new SiteStats();
    for (let i = 0; i < SITE_STATS_CAPACITY; i++) {
      stats.record('contained', `host${i}.example.com`, i + 1);
    }
    // Touch the oldest so it becomes newest, then push one more in.
    stats.record('contained', 'host0.example.com', SITE_STATS_CAPACITY + 10);
    stats.record('contained', 'fresh.example.com', SITE_STATS_CAPACITY + 20);
    expect(stats.size).toBe(SITE_STATS_CAPACITY);
    const hosts = stats.snapshot().map((e) => e.host);
    expect(hosts[0]).toBe('fresh.example.com');
    expect(hosts).not.toContain('host1.example.com'); // oldest, untouched
    expect(hosts).toContain('host0.example.com'); // refreshed, survives
  });

  it('clear() empties everything', () => {
    const stats = new SiteStats();
    stats.record('contained', 'a.example.com', 1);
    stats.clear();
    expect(stats.size).toBe(0);
    expect(stats.snapshot()).toEqual([]);
  });

  describe('restore', () => {
    it('accepts a valid snapshot round-trip', () => {
      const stats = new SiteStats();
      stats.record('contained', 'mail.google.com', 5);
      stats.record('trackersBlocked', 'news.example.com', 6);
      const restored = new SiteStats();
      restored.restore(JSON.parse(JSON.stringify(stats.snapshot())));
      expect(restored.snapshot()).toEqual(stats.snapshot());
    });

    it('discards malformed rows instead of crashing', () => {
      const stats = new SiteStats();
      stats.restore([
        null,
        42,
        { host: 'https://bad' },
        { host: 'ok.example.com' }, // all zeros, no lastSeen -> dropped
        { host: 'good.example.com', contained: 3, lastSeen: 9 },
        { host: 'negative.example.com', contained: -5, lastSeen: -1 }, // values dropped
        { host: 'float.example.com', released: 2.9, lastSeen: 4 }, // floored
      ]);
      const snapshot = stats.snapshot();
      expect(snapshot.map((e) => e.host)).toEqual(['good.example.com', 'float.example.com']);
      expect(snapshot.find((e) => e.host === 'float.example.com')!.released).toBe(2);
    });

    it('ignores non-array input', () => {
      const stats = new SiteStats();
      stats.restore(undefined);
      stats.restore({ host: 'x.example.com' });
      expect(stats.size).toBe(0);
    });

    it('caps restored tables at capacity', () => {
      const stats = new SiteStats();
      const flood = Array.from({ length: SITE_STATS_CAPACITY + 50 }, (_, i) => ({
        host: `h${i}.example.com`,
        contained: 1,
        lastSeen: i,
      }));
      stats.restore(flood);
      expect(stats.size).toBe(SITE_STATS_CAPACITY);
    });
  });
});
