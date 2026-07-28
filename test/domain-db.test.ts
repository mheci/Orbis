/** Domain database integrity tests. */

import { describe, expect, it } from 'vitest';
import {
  buildDomainDatabase,
  expandCcTLDs,
  getDomainDatabase,
  normalizeHostPattern,
  resetDomainDatabase,
} from '../src/core/domain-db.js';

describe('normalizeHostPattern', () => {
  it.each([
    ['Google.COM', 'google.com'],
    ['*.google.com', 'google.com'],
    ['.google.com.', 'google.com'],
    ['  google.com  ', 'google.com'],
  ])('normalises %s -> %s', (input, expected) => {
    expect(normalizeHostPattern(input)).toBe(expected);
  });
});

describe('expandCcTLDs', () => {
  it('produces the cartesian product', () => {
    expect(expandCcTLDs(['google'], ['com', 'co.uk'])).toEqual(['google.com', 'google.co.uk']);
  });

  it('skips empty entries', () => {
    expect(expandCcTLDs(['', 'google'], ['de', ''])).toEqual(['google.de']);
  });
});

describe('database build', () => {
  const db = buildDomainDatabase();

  it('exposes the expected sets', () => {
    expect(db.sets.map((s) => s.id).sort()).toEqual(['google', 'hosting', 'trackers', 'youtube']);
  });

  it('enables only the safe sets by default', () => {
    const byId = Object.fromEntries(db.sets.map((s) => [s.id, s.defaultEnabled]));
    expect(byId).toEqual({ google: true, youtube: true, trackers: false, hosting: false });
  });

  it('contains a substantial number of hosts', () => {
    expect(db.hostCount).toBeGreaterThan(600);
  });

  it('has no duplicate hosts within a set', () => {
    for (const set of db.sets) {
      expect(new Set(set.hosts).size).toBe(set.hosts.length);
    }
  });

  it('stores every host lower-cased and without wildcards or schemes', () => {
    for (const set of db.sets) {
      for (const host of set.hosts) {
        expect(host).toBe(host.toLowerCase());
        expect(host).not.toContain('*');
        expect(host).not.toContain('/');
        expect(host).toMatch(/^[a-z0-9.-]+$/);
        expect(host).toContain('.');
      }
    }
  });

  it('includes the key ccTLD expansions', () => {
    const google = db.sets.find((s) => s.id === 'google')!;
    for (const host of ['google.co.uk', 'google.de', 'google.com.eg', 'blogspot.com']) {
      expect(google.hosts).toContain(host);
    }
  });

  it('defines brand gTLDs for future-proofing', () => {
    expect(db.brandTLDs).toContain('google');
    expect(db.brandTLDs).toContain('youtube');
  });

  it('defines redirectors with at least one parameter each', () => {
    expect(db.redirectors.length).toBeGreaterThan(0);
    for (const rule of db.redirectors) expect(rule.params.length).toBeGreaterThan(0);
  });

  it('caches the singleton and can be reset', () => {
    const first = getDomainDatabase();
    expect(getDomainDatabase()).toBe(first);
    resetDomainDatabase();
    expect(getDomainDatabase()).not.toBe(first);
  });
});
