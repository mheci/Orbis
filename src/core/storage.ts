/**
 * Storage adapter.
 *
 * Wraps `browser.storage` behind a small interface so the rest of the code (and
 * the unit tests) never touch the WebExtension API directly. All operations are
 * failure-tolerant: if storage is unavailable or throws, we keep serving the
 * in-memory copy and report the error through the diagnostics channel.
 */

import type { Settings } from '../types/index.js';
import { STORAGE_KEY, defaultSettings, migrateSettings } from './settings.js';

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StorageBackends {
  readonly local: StorageArea | null;
  readonly sync: StorageArea | null;
}

/** Bind to the real WebExtension storage, tolerating missing `sync`. */
export function browserStorageBackends(): StorageBackends {
  const api = (globalThis as { browser?: typeof browser }).browser;
  const local = api?.storage?.local as unknown as StorageArea | undefined;
  const sync = api?.storage?.sync as unknown as StorageArea | undefined;
  return { local: local ?? null, sync: sync ?? null };
}

/** Timestamped envelope so we can pick the newer copy between local and sync. */
interface StoredEnvelope {
  savedAt: number;
  settings: unknown;
}

export class SettingsStore {
  private cache: Settings;
  private readonly errors: string[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly backends: StorageBackends = browserStorageBackends()) {
    this.cache = defaultSettings();
  }

  /** Last few storage errors, surfaced in diagnostics. */
  recentErrors(): string[] {
    return [...this.errors];
  }

  private recordError(scope: string, error: unknown): void {
    const message = `${new Date().toISOString()} ${scope}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    this.errors.push(message);
    if (this.errors.length > 20) this.errors.shift();
    console.warn('[orbis]', message);
  }

  private async read(area: StorageArea | null, scope: string): Promise<StoredEnvelope | null> {
    if (area === null) return null;
    try {
      const raw = await area.get(STORAGE_KEY);
      const value = raw?.[STORAGE_KEY];
      if (typeof value !== 'object' || value === null) return null;
      const envelope = value as Record<string, unknown>;
      if ('settings' in envelope) {
        return {
          savedAt: typeof envelope['savedAt'] === 'number' ? envelope['savedAt'] : 0,
          settings: envelope['settings'],
        };
      }
      // Tolerate a bare settings object written by an older build.
      return { savedAt: 0, settings: envelope };
    } catch (error) {
      this.recordError(`read:${scope}`, error);
      return null;
    }
  }

  /** Load settings, preferring whichever backend holds the newer document. */
  async load(): Promise<Settings> {
    const [local, sync] = await Promise.all([
      this.read(this.backends.local, 'local'),
      this.read(this.backends.sync, 'sync'),
    ]);

    let chosen: StoredEnvelope | null = local;
    if (sync !== null && (local === null || sync.savedAt > local.savedAt)) {
      // Only trust sync when the user previously enabled it.
      const syncSettings = sync.settings as Record<string, unknown> | null;
      const behaviour = syncSettings?.['behaviour'] as Record<string, unknown> | undefined;
      if (behaviour?.['useSync'] === true) chosen = sync;
    }

    this.cache = chosen === null ? defaultSettings() : migrateSettings(chosen.settings);
    return this.cache;
  }

  /** Current in-memory settings; always valid, never null. */
  get(): Settings {
    return this.cache;
  }

  /**
   * Persist settings. Writes are serialised through a promise chain so two rapid
   * updates can never interleave and lose data.
   */
  async save(settings: Settings): Promise<void> {
    this.cache = settings;
    const envelope: StoredEnvelope = { savedAt: Date.now(), settings };
    this.writeChain = this.writeChain.then(async () => {
      if (this.backends.local !== null) {
        try {
          await this.backends.local.set({ [STORAGE_KEY]: envelope });
        } catch (error) {
          this.recordError('write:local', error);
        }
      }
      if (settings.behaviour.useSync && this.backends.sync !== null) {
        try {
          await this.backends.sync.set({ [STORAGE_KEY]: envelope });
        } catch (error) {
          // Sync quota exceeded is common and must never break local operation.
          this.recordError('write:sync', error);
        }
      }
    });
    return this.writeChain;
  }

  /** Wipe stored settings and return freshly generated defaults. */
  async reset(): Promise<Settings> {
    const fresh = defaultSettings();
    try {
      await this.backends.local?.remove(STORAGE_KEY);
    } catch (error) {
      this.recordError('reset:local', error);
    }
    try {
      await this.backends.sync?.remove(STORAGE_KEY);
    } catch (error) {
      this.recordError('reset:sync', error);
    }
    await this.save(fresh);
    return fresh;
  }

  available(): { local: boolean; sync: boolean } {
    return { local: this.backends.local !== null, sync: this.backends.sync !== null };
  }
}

/** In-memory backend used by unit tests and as a last-resort fallback. */
export function memoryStorageArea(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}
