/**
 * A behavioural mock of the subset of the WebExtension API that Orbis
 * uses.
 *
 * This exists because the background worker was previously untested: the pure
 * core had 98% coverage while the adapter that actually talks to Firefox had
 * none. That is exactly the layer where "works in theory" and "works in the
 * browser" diverge, so the mock models real Firefox semantics rather than
 * returning convenient values:
 *
 *  - `tabs.create` allocates a real id, honours `cookieStoreId`, and records
 *    creation order so tab-position assertions are meaningful.
 *  - `tabs.remove` genuinely removes the tab; a later `tabs.get` rejects, which
 *    is what Firefox does and what the adapter's error handling must survive.
 *  - `contextualIdentities.get` rejects for unknown ids (Firefox throws rather
 *    than returning undefined).
 *  - Listeners are invoked with the same argument shapes Firefox uses.
 */

export interface MockTab {
  id: number;
  url: string;
  cookieStoreId: string;
  active: boolean;
  index: number;
  windowId: number;
  incognito: boolean;
  openerTabId?: number;
}

export interface MockIdentity {
  cookieStoreId: string;
  name: string;
  color: string;
  icon: string;
}

type Listener = (...args: unknown[]) => unknown;

class Event {
  readonly listeners: Listener[] = [];
  addListener(fn: Listener): void {
    this.listeners.push(fn);
  }
  removeListener(fn: Listener): void {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  hasListener(fn: Listener): boolean {
    return this.listeners.includes(fn);
  }
  async emit(...args: unknown[]): Promise<unknown[]> {
    return Promise.all(this.listeners.map((l) => l(...args)));
  }
}

export class MockBrowser {
  tabsById = new Map<number, MockTab>();
  identities = new Map<string, MockIdentity>();
  storageLocal = new Map<string, unknown>();
  storageSync = new Map<string, unknown>();
  createdTabs: MockTab[] = [];
  removedTabIds: number[] = [];
  menuItems: Array<{ id: string; title: string; contexts: string[] }> = [];
  badgeText: string | null = null;
  badgeByTab = new Map<number, string>();
  badgeTitle: string | null = null;

  /** Internal counters, readable by buildApi(). */
  nextTabId = 100;
  nextContainer = 1;
  /** Fault injection: make the next N tabs.create calls reject. */
  failNextCreates = 0;
  /** Fault injection: make contextualIdentities.create always reject. */
  failIdentityCreate = false;

  readonly webRequestOnBeforeRequest = new Event();
  readonly runtimeOnMessage = new Event();
  readonly tabsOnRemoved = new Event();
  readonly tabsOnCreated = new Event();
  readonly tabsOnUpdated = new Event();
  readonly identitiesOnRemoved = new Event();
  readonly runtimeOnInstalled = new Event();
  readonly runtimeOnStartup = new Event();
  readonly menusOnClicked = new Event();

  addTab(partial: Partial<MockTab> = {}): MockTab {
    const tab: MockTab = {
      id: this.nextTabId++,
      url: 'about:blank',
      cookieStoreId: 'firefox-default',
      active: true,
      index: this.tabsById.size,
      windowId: 1,
      incognito: false,
      ...partial,
    };
    this.tabsById.set(tab.id, tab);
    return tab;
  }

  /** Build the `browser` global. */
  api(): Record<string, unknown> {
    return buildApi(this);
  }

  install(): void {
    (globalThis as Record<string, unknown>)['browser'] = this.api();
    (globalThis as Record<string, unknown>)['navigator'] ??= { userAgent: 'test' };
  }

  static uninstall(): void {
    delete (globalThis as Record<string, unknown>)['browser'];
  }
}

/**
 * Build the `browser` global for a given mock.
 *
 * A free function rather than a method: the returned object mirrors the
 * WebExtension API, whose entries are plain functions, so they need the mock
 * passed in explicitly instead of relying on `this`.
 */
function buildApi(mock: MockBrowser): Record<string, unknown> {
  return {
    tabs: {
      async get(id: number) {
        const tab = mock.tabsById.get(id);
        // Firefox rejects for a missing tab; the adapter must cope.
        if (tab === undefined) throw new Error(`No tab with id: ${id}`);
        return { ...tab };
      },
      async query(info: { active?: boolean; currentWindow?: boolean }) {
        let all = [...mock.tabsById.values()];
        if (info.active === true) all = all.filter((t) => t.active);
        return all.map((t) => ({ ...t }));
      },
      async create(props: Record<string, unknown>) {
        if (mock.failNextCreates > 0) {
          mock.failNextCreates--;
          throw new Error('tabs.create failed (simulated)');
        }
        const tab = mock.addTab({
          url: String(props['url'] ?? 'about:blank'),
          cookieStoreId: String(props['cookieStoreId'] ?? 'firefox-default'),
          active: props['active'] === true,
          index:
            typeof props['index'] === 'number' ? (props['index'] as number) : mock.tabsById.size,
          windowId: typeof props['windowId'] === 'number' ? (props['windowId'] as number) : 1,
          openerTabId:
            typeof props['openerTabId'] === 'number' ? (props['openerTabId'] as number) : undefined,
        });
        mock.createdTabs.push(tab);
        void mock.tabsOnCreated.emit({ ...tab });
        return { ...tab };
      },
      async remove(id: number) {
        if (!mock.tabsById.has(id)) throw new Error(`No tab with id: ${id}`);
        mock.tabsById.delete(id);
        mock.removedTabIds.push(id);
      },
      onRemoved: mock.tabsOnRemoved,
      onCreated: mock.tabsOnCreated,
      onUpdated: mock.tabsOnUpdated,
    },
    contextualIdentities: {
      async query({ name }: { name?: string }) {
        return [...mock.identities.values()].filter((i) => name === undefined || i.name === name);
      },
      async get(id: string) {
        const found = mock.identities.get(id);
        if (found === undefined) throw new Error('Invalid contextual identity');
        return { ...found };
      },
      async create(details: { name: string; color: string; icon: string }) {
        if (mock.failIdentityCreate) throw new Error('containers disabled (simulated)');
        const identity: MockIdentity = {
          cookieStoreId: `firefox-container-${mock.nextContainer++}`,
          ...details,
        };
        mock.identities.set(identity.cookieStoreId, identity);
        return { ...identity };
      },
      async update(id: string, details: Record<string, string>) {
        const existing = mock.identities.get(id);
        if (existing === undefined) throw new Error('Invalid contextual identity');
        const updated = { ...existing, ...details };
        mock.identities.set(id, updated);
        return { ...updated };
      },
      onRemoved: mock.identitiesOnRemoved,
    },
    storage: {
      local: {
        async get(key: string) {
          return mock.storageLocal.has(key) ? { [key]: mock.storageLocal.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) mock.storageLocal.set(k, v);
        },
        async remove(key: string) {
          mock.storageLocal.delete(key);
        },
      },
      sync: {
        async get(key: string) {
          return mock.storageSync.has(key) ? { [key]: mock.storageSync.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) mock.storageSync.set(k, v);
        },
        async remove(key: string) {
          mock.storageSync.delete(key);
        },
      },
    },
    webRequest: { onBeforeRequest: mock.webRequestOnBeforeRequest },
    runtime: {
      onMessage: mock.runtimeOnMessage,
      onInstalled: mock.runtimeOnInstalled,
      onStartup: mock.runtimeOnStartup,
      getManifest: () => ({ version: '1.0.0' }),
      openOptionsPage: async () => {},
      sendMessage: async () => {},
    },
    i18n: {
      // Minimal stand-in: substitute $1..$n placeholders and fall back to the
      // key itself so tests never crash on a missing locale file.
      getMessage(key: string, substitutions?: string | string[]) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        return key.replace(/\$(\d+)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
      },
    },
    action: {
      async setBadgeText(d: { text: string; tabId?: number }) {
        mock.badgeText = d.text;
        if (typeof d.tabId === 'number') mock.badgeByTab.set(d.tabId, d.text);
      },
      async setBadgeBackgroundColor() {},
      async setTitle(d: { title: string }) {
        mock.badgeTitle = d.title;
      },
    },
    menus: {
      create(item: { id: string; title: string; contexts: string[] }) {
        mock.menuItems.push(item);
        return item.id;
      },
      removeAll() {
        mock.menuItems.length = 0;
      },
      onClicked: mock.menusOnClicked,
    },
  };
}
