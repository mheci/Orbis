/** Shared test helpers: settings factories and fake browser APIs. */

import { UrlMatcher } from '../src/core/matcher.js';
import { defaultSettings } from '../src/core/settings.js';
import type { DeepPartial, Settings } from '../src/types/index.js';
import type { ContextualIdentitiesApi, ContextualIdentityLike } from '../src/core/container.js';

export function makeSettings(overrides: DeepPartial<Settings> = {}): Settings {
  const base = defaultSettings();
  return {
    ...base,
    ...overrides,
    container: { ...base.container, ...(overrides.container ?? {}) },
    behaviour: { ...base.behaviour, ...(overrides.behaviour ?? {}) },
    domainSets: { ...base.domainSets, ...(overrides.domainSets ?? {}) },
    statistics: { ...base.statistics, ...(overrides.statistics ?? {}) },
  } as Settings;
}

export function makeMatcher(overrides: DeepPartial<Settings> = {}): UrlMatcher {
  return new UrlMatcher(makeSettings(overrides));
}

/** In-memory contextualIdentities implementation for container tests. */
export function fakeIdentities(initial: ContextualIdentityLike[] = []): ContextualIdentitiesApi & {
  store: Map<string, ContextualIdentityLike>;
  createCalls: number;
} {
  const store = new Map<string, ContextualIdentityLike>();
  for (const identity of initial) store.set(identity.cookieStoreId, identity);
  let counter = initial.length;
  const api = {
    store,
    createCalls: 0,
    async query({ name }: { name?: string }) {
      return [...store.values()].filter((i) => name === undefined || i.name === name);
    },
    async get(cookieStoreId: string) {
      const found = store.get(cookieStoreId);
      if (found === undefined) throw new Error('no such container');
      return found;
    },
    async create(details: { name: string; color: string; icon: string }) {
      api.createCalls++;
      counter++;
      const identity: ContextualIdentityLike = {
        cookieStoreId: `firefox-container-${counter}`,
        ...details,
      };
      store.set(identity.cookieStoreId, identity);
      return identity;
    },
    async update(cookieStoreId: string, details: { name?: string; color?: string; icon?: string }) {
      const existing = store.get(cookieStoreId);
      if (existing === undefined) throw new Error('no such container');
      const updated = { ...existing, ...details };
      store.set(cookieStoreId, updated);
      return updated;
    },
  };
  return api;
}
