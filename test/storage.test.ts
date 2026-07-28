/** Storage adapter tests: persistence, corruption recovery, sync fallback. */

import { describe, expect, it } from 'vitest';
import { SettingsStore, memoryStorageArea, type StorageArea } from '../src/core/storage.js';
import { STORAGE_KEY, defaultSettings, mergeSettings } from '../src/core/settings.js';

function failingArea(): StorageArea {
  return {
    async get() {
      throw new Error('storage unavailable');
    },
    async set() {
      throw new Error('quota exceeded');
    },
    async remove() {
      throw new Error('nope');
    },
  };
}

describe('SettingsStore', () => {
  it('returns defaults on a fresh profile', async () => {
    const store = new SettingsStore({ local: memoryStorageArea(), sync: null });
    const settings = await store.load();
    expect(settings.enabled).toBe(true);
    expect(store.get()).toEqual(settings);
  });

  it('round-trips saved settings', async () => {
    const local = memoryStorageArea();
    const a = new SettingsStore({ local, sync: null });
    await a.load();
    await a.save(mergeSettings(defaultSettings(), { container: { name: 'Custom' } }));

    const b = new SettingsStore({ local, sync: null });
    expect((await b.load()).container.name).toBe('Custom');
  });

  it('recovers from corrupted storage contents', async () => {
    const local = memoryStorageArea();
    await local.set({ [STORAGE_KEY]: 'not an object' });
    const store = new SettingsStore({ local, sync: null });
    expect((await store.load()).enabled).toBe(true);
  });

  it('recovers from a partially corrupted settings object', async () => {
    const local = memoryStorageArea();
    await local.set({
      [STORAGE_KEY]: { savedAt: 1, settings: { enabled: 'maybe', container: null } },
    });
    const store = new SettingsStore({ local, sync: null });
    const settings = await store.load();
    expect(settings.enabled).toBe(true);
    expect(settings.container.name).toBe('Google');
  });

  it('tolerates a bare settings object written by an older build', async () => {
    const local = memoryStorageArea();
    await local.set({ [STORAGE_KEY]: { enabled: false, schemaVersion: 1 } });
    const store = new SettingsStore({ local, sync: null });
    expect((await store.load()).enabled).toBe(false);
  });

  it('keeps working when storage throws', async () => {
    const store = new SettingsStore({ local: failingArea(), sync: null });
    const settings = await store.load();
    expect(settings.enabled).toBe(true);
    await expect(store.save(settings)).resolves.toBeUndefined();
    expect(store.recentErrors().length).toBeGreaterThan(0);
  });

  it('only adopts sync data when the user enabled sync', async () => {
    const local = memoryStorageArea();
    const sync = memoryStorageArea();
    await local.set({
      [STORAGE_KEY]: {
        savedAt: 1,
        settings: { ...defaultSettings(), container: { name: 'Local' } },
      },
    });
    await sync.set({
      [STORAGE_KEY]: {
        savedAt: 999,
        settings: { ...defaultSettings(), container: { name: 'Sync' } },
      },
    });
    const withoutSync = new SettingsStore({ local, sync });
    expect((await withoutSync.load()).container.name).toBe('Local');

    await sync.set({
      [STORAGE_KEY]: {
        savedAt: 999,
        settings: {
          ...defaultSettings(),
          behaviour: { ...defaultSettings().behaviour, useSync: true },
          container: { name: 'Sync' },
        },
      },
    });
    const withSync = new SettingsStore({ local, sync });
    expect((await withSync.load()).container.name).toBe('Sync');
  });

  it('does not fail the whole save when sync write fails', async () => {
    const local = memoryStorageArea();
    const store = new SettingsStore({ local, sync: failingArea() });
    await store.load();
    const settings = mergeSettings(defaultSettings(), { behaviour: { useSync: true } });
    await expect(store.save(settings)).resolves.toBeUndefined();
    const persisted = await local.get(STORAGE_KEY);
    expect(persisted[STORAGE_KEY]).toBeDefined();
  });

  it('serialises concurrent writes without losing the last value', async () => {
    const local = memoryStorageArea();
    const store = new SettingsStore({ local, sync: null });
    await store.load();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.save(mergeSettings(defaultSettings(), { container: { name: `n${i}` } }))
      )
    );
    const reloaded = new SettingsStore({ local, sync: null });
    expect((await reloaded.load()).container.name).toBe('n19');
  });

  it('resets to defaults', async () => {
    const local = memoryStorageArea();
    const store = new SettingsStore({ local, sync: null });
    await store.load();
    await store.save(mergeSettings(defaultSettings(), { enabled: false }));
    const fresh = await store.reset();
    expect(fresh.enabled).toBe(true);
  });

  it('reports backend availability', () => {
    expect(new SettingsStore({ local: memoryStorageArea(), sync: null }).available()).toEqual({
      local: true,
      sync: false,
    });
  });
});
