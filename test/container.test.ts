/** Container lifecycle tests: creation, reuse, recovery and races. */

import { describe, expect, it, vi } from 'vitest';
import { ContainerManager } from '../src/core/container.js';
import { fakeIdentities } from './helpers.js';

const SPEC = { name: 'Orbis', color: 'red', icon: 'fingerprint' } as const;

describe('ContainerManager', () => {
  it('creates the container on first use', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const id = await manager.ensure(SPEC);
    expect(id).toMatch(/^firefox-container-/);
    expect(api.createCalls).toBe(1);
  });

  it('reuses the container on subsequent calls', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const first = await manager.ensure(SPEC);
    const second = await manager.ensure(SPEC);
    expect(second).toBe(first);
    expect(api.createCalls).toBe(1);
  });

  it('never creates two containers under concurrent calls', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const ids = await Promise.all(Array.from({ length: 25 }, () => manager.ensure(SPEC)));
    expect(new Set(ids).size).toBe(1);
    expect(api.createCalls).toBe(1);
  });

  it('adopts an existing container with the same name (survives reinstall)', async () => {
    const api = fakeIdentities([
      { cookieStoreId: 'firefox-container-9', name: 'Orbis', color: 'blue', icon: 'briefcase' },
    ]);
    const manager = new ContainerManager(api);
    expect(await manager.ensure(SPEC)).toBe('firefox-container-9');
    expect(api.createCalls).toBe(0);
  });

  it('restores a persisted id across a restart', async () => {
    const api = fakeIdentities([
      { cookieStoreId: 'firefox-container-3', name: 'Orbis', color: 'red', icon: 'fingerprint' },
    ]);
    const manager = new ContainerManager(
      api,
      async () => {},
      async () => 'firefox-container-3'
    );
    expect(await manager.ensure(SPEC)).toBe('firefox-container-3');
    expect(api.createCalls).toBe(0);
  });

  it('recreates the container after the user deletes it', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const first = await manager.ensure(SPEC);
    api.store.delete(first!);
    await manager.invalidate(first!);
    const second = await manager.ensure(SPEC);
    expect(second).not.toBe(first);
    expect(api.createCalls).toBe(2);
  });

  it('ignores removal events for other containers', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const id = await manager.ensure(SPEC);
    await manager.invalidate('firefox-container-999');
    expect(manager.id).toBe(id);
  });

  it('discards a stale persisted id that no longer exists', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(
      api,
      async () => {},
      async () => 'firefox-container-gone'
    );
    const id = await manager.ensure(SPEC);
    expect(id).not.toBe('firefox-container-gone');
    expect(api.createCalls).toBe(1);
  });

  it('persists the id whenever it changes', async () => {
    const persist = vi.fn(async () => {});
    const manager = new ContainerManager(fakeIdentities(), persist);
    await manager.ensure(SPEC);
    expect(persist).toHaveBeenCalledWith(expect.stringContaining('firefox-container-'));
  });

  it('applies a renamed/recoloured spec in place', async () => {
    const api = fakeIdentities();
    const manager = new ContainerManager(api);
    const id = await manager.ensure(SPEC);
    await manager.applySpec({ name: 'Big G', color: 'purple', icon: 'briefcase' });
    expect(api.store.get(id!)!.name).toBe('Big G');
    expect(api.store.get(id!)!.color).toBe('purple');
  });

  it('degrades gracefully when contextualIdentities is unavailable', async () => {
    const manager = new ContainerManager(null);
    expect(manager.supported).toBe(false);
    expect(await manager.ensure(SPEC)).toBeNull();
    await expect(manager.applySpec(SPEC)).resolves.toBeUndefined();
  });

  it('survives an API that throws', async () => {
    const throwing = {
      query: async () => {
        throw new Error('boom');
      },
      get: async () => {
        throw new Error('boom');
      },
      create: async () => {
        throw new Error('boom');
      },
      update: async () => {
        throw new Error('boom');
      },
    };
    const manager = new ContainerManager(throwing);
    expect(await manager.ensure(SPEC)).toBeNull();
  });
});
