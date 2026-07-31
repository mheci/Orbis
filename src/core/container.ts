/**
 * Contextual identity (container) lifecycle management.
 *
 * Responsibilities
 * ----------------
 * - Find or create the dedicated Google container exactly once, even when
 *   several navigations race on startup (see `ensure()`'s in-flight promise).
 * - Recover automatically when the user deletes or renames the container.
 * - Keep the stored `cookieStoreId` in sync with reality, because container IDs
 *   change on profile restore and after some Firefox upgrades.
 */

import type { ContainerColor, ContainerIcon } from '../types/index.js';

/** Minimal surface of `browser.contextualIdentities` that we depend on. */
export interface ContextualIdentitiesApi {
  query(details: { name?: string }): Promise<ContextualIdentityLike[]>;
  get(cookieStoreId: string): Promise<ContextualIdentityLike>;
  create(details: { name: string; color: string; icon: string }): Promise<ContextualIdentityLike>;
  update(
    cookieStoreId: string,
    details: { name?: string; color?: string; icon?: string }
  ): Promise<ContextualIdentityLike>;
}

export interface ContextualIdentityLike {
  cookieStoreId: string;
  name: string;
  color: string;
  icon: string;
}

export interface ContainerSpec {
  readonly name: string;
  readonly color: ContainerColor;
  readonly icon: ContainerIcon;
}

/** Key under which we remember the container id between sessions. */
export const CONTAINER_ID_KEY = 'cookieStoreId';

export class ContainerManager {
  private cookieStoreId: string | null = null;
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly api: ContextualIdentitiesApi | null,
    private readonly persist: (id: string | null) => Promise<void> = async () => {},
    private readonly restore: () => Promise<string | null> = async () => null
  ) {}

  /** True when the contextualIdentities API is usable (containers enabled). */
  get supported(): boolean {
    return this.api !== null;
  }

  get id(): string | null {
    return this.cookieStoreId;
  }

  /**
   * Return the container's cookieStoreId, creating the container if needed.
   * Concurrent callers share a single in-flight promise so we can never create
   * two containers for one profile.
   */
  async ensure(spec: ContainerSpec): Promise<string | null> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.resolve(spec).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async resolve(spec: ContainerSpec): Promise<string | null> {
    const api = this.api;
    if (api === null) return null;

    // 1. Reuse the cached id when it still points at a live container.
    if (this.cookieStoreId !== null && (await this.exists(this.cookieStoreId))) {
      return this.cookieStoreId;
    }

    // 2. Try the id we persisted in a previous session.
    const remembered = await this.safe(() => this.restore(), null);
    if (remembered !== null && (await this.exists(remembered))) {
      this.cookieStoreId = remembered;
      return remembered;
    }

    // 3. Look for a container with the configured name (survives reinstall).
    const byName = await this.safe(() => api.query({ name: spec.name }), []);
    const existing = byName[0];
    if (existing !== undefined) {
      this.cookieStoreId = existing.cookieStoreId;
      await this.persist(this.cookieStoreId);
      return this.cookieStoreId;
    }

    // 4. Create it.
    const created = await this.safe(
      () => api.create({ name: spec.name, color: spec.color, icon: spec.icon }),
      null
    );
    if (created === null) return null;
    this.cookieStoreId = created.cookieStoreId;
    await this.persist(this.cookieStoreId);
    return this.cookieStoreId;
  }

  /** Apply a new name/colour/icon to the existing container. */
  async applySpec(spec: ContainerSpec): Promise<void> {
    const api = this.api;
    if (api === null) return;
    const id = await this.ensure(spec);
    if (id === null) return;
    await this.safe(
      () => api.update(id, { name: spec.name, color: spec.color, icon: spec.icon }),
      null
    );
  }

  /** Forget the cached id, e.g. after `contextualIdentities.onRemoved`. */
  async invalidate(removedId?: string): Promise<void> {
    if (removedId !== undefined && removedId !== this.cookieStoreId) return;
    this.cookieStoreId = null;
    await this.persist(null);
  }

  async exists(cookieStoreId: string): Promise<boolean> {
    const api = this.api;
    if (api === null) return false;
    try {
      const identity = await api.get(cookieStoreId);
      return identity !== undefined && identity !== null;
    } catch {
      return false;
    }
  }

  private async safe<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.warn('[orbis] container operation failed:', error);
      return fallback;
    }
  }
}
