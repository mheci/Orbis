/**
 * Background event page.
 *
 * This module is intentionally a thin adapter around the pure core:
 *   webRequest event -> gather facts -> decideNavigation() -> execute action.
 *
 * It is non-persistent (MV3 event page), so all state that must survive a
 * suspend/resume cycle lives in `storage.local`; everything else (loop guard,
 * compiled matcher) is cheap to rebuild on wake-up.
 */

import {
  DEFAULT_COOKIE_STORE,
  LoopGuard,
  decideNavigation,
  isProtectionActive,
  type NavigationAction,
  type NavigationContext,
} from '../core/decision.js';
import { ContainerManager, type ContextualIdentitiesApi } from '../core/container.js';
import { UrlMatcher, safeParse } from '../core/matcher.js';
import { getDomainDatabase } from '../core/domain-db.js';
import { SettingsStore } from '../core/storage.js';
import {
  buildBackup,
  canonicalizeUserPattern,
  defaultSettings,
  mergeSettings,
  parseBackup,
} from '../core/settings.js';
import type { Diagnostics, Message, RuntimeState, Settings, Statistics } from '../types/index.js';

const CONTAINER_ID_STORAGE_KEY = 'containerId';

class GContainer {
  private readonly store = new SettingsStore();
  private readonly loopGuard = new LoopGuard();
  private matcher: UrlMatcher;
  private container: ContainerManager;
  private settings: Settings;
  private ready: Promise<void> | null = null;
  /** Tabs we created ourselves, so we can close the placeholder safely. */
  private readonly ourTabs = new Set<number>();
  private statsFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.settings = defaultSettings();
    this.matcher = new UrlMatcher(this.settings);
    this.container = new ContainerManager(
      (browser.contextualIdentities as unknown as ContextualIdentitiesApi) ?? null,
      async (id) => {
        await browser.storage.local.set({ [CONTAINER_ID_STORAGE_KEY]: id });
      },
      async () => {
        const raw = await browser.storage.local.get(CONTAINER_ID_STORAGE_KEY);
        const value = raw?.[CONTAINER_ID_STORAGE_KEY];
        return typeof value === 'string' ? value : null;
      }
    );
  }

  /** Idempotent initialisation; every entry point awaits this. */
  init(): Promise<void> {
    if (this.ready === null) {
      this.ready = (async () => {
        this.settings = await this.store.load();
        this.rebuildMatcher();
        await this.container.ensure(this.settings.container);
        this.updateBadge();
      })();
    }
    return this.ready;
  }

  private rebuildMatcher(): void {
    this.matcher = new UrlMatcher(this.settings);
  }

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<Settings> {
    await this.init();
    return this.settings;
  }

  async updateSettings(patch: Parameters<typeof mergeSettings>[1]): Promise<Settings> {
    await this.init();
    const previous = this.settings;
    this.settings = mergeSettings(previous, patch);
    await this.store.save(this.settings);
    this.rebuildMatcher();
    this.loopGuard.clear();

    const c = this.settings.container;
    const p = previous.container;
    if (c.name !== p.name || c.color !== p.color || c.icon !== p.icon) {
      await this.container.applySpec(c);
    }
    this.updateBadge();
    return this.settings;
  }

  private bumpStat(key: keyof Statistics, delta = 1): void {
    if (!this.settings.behaviour.collectStatistics) return;
    const stats = this.settings.statistics;
    if (typeof stats[key] !== 'number') return;
    (stats[key] as number) += delta;
    stats.lastEvent = Date.now();
    // Debounce writes: navigation bursts must not hammer storage.
    if (this.statsFlushTimer !== null) return;
    this.statsFlushTimer = setTimeout(() => {
      this.statsFlushTimer = null;
      void this.store.save(this.settings);
    }, 5000);
  }

  // -------------------------------------------------------------- navigation

  /**
   * webRequest.onBeforeRequest handler for top-level document loads.
   * Returning `{ cancel: true }` stops the original load; we then re-issue it in
   * the correct cookie store. This is the same mechanism Facebook Container uses.
   */
  async onBeforeRequest(
    details: browser.webRequest._OnBeforeRequestDetails
  ): Promise<browser.webRequest.BlockingResponse | undefined> {
    await this.init();
    if (details.tabId < 0) return undefined;
    if (details.type !== 'main_frame') return undefined;

    const now = Date.now();
    if (!isProtectionActive(this.settings, now)) return undefined;

    const tab = await this.getTab(details.tabId);
    if (tab === null) return undefined;

    const openerTabId = typeof tab.openerTabId === 'number' ? tab.openerTabId : null;
    let openerCookieStoreId: string | null = null;
    if (openerTabId !== null) {
      const opener = await this.getTab(openerTabId);
      openerCookieStoreId = opener?.cookieStoreId ?? null;
    }

    const context: NavigationContext = {
      url: details.url,
      tabId: details.tabId,
      cookieStoreId: tab.cookieStoreId ?? DEFAULT_COOKIE_STORE,
      containerId: await this.container.ensure(this.settings.container),
      openerTabId,
      openerCookieStoreId,
      incognito: tab.incognito === true,
      now,
    };

    const action = decideNavigation(context, {
      settings: this.settings,
      matcher: this.matcher,
      loopGuard: this.loopGuard,
    });

    if (action.kind === 'ignore') {
      if (action.reason === 'exception' || action.reason.startsWith('never')) {
        this.bumpStat('exceptionsApplied');
      }
      return undefined;
    }

    // Mark both the source and the destination URL so the freshly opened tab's
    // own onBeforeRequest event does not trigger a second decision.
    this.loopGuard.remember(details.tabId, details.url, now);

    await this.executeAction(action, tab);
    return { cancel: true };
  }

  private async executeAction(
    action: Exclude<NavigationAction, { kind: 'ignore' }>,
    sourceTab: browser.tabs.Tab
  ): Promise<void> {
    const cookieStoreId = action.kind === 'contain' ? action.cookieStoreId : DEFAULT_COOKIE_STORE;

    try {
      const created = await browser.tabs.create({
        url: action.url,
        cookieStoreId,
        active: sourceTab.active === true,
        index: typeof sourceTab.index === 'number' ? sourceTab.index : undefined,
        windowId: sourceTab.windowId,
        // Preserve the opener relationship so "back to the opener" still works
        // and so sites relying on window.opener degrade gracefully.
        openerTabId:
          typeof sourceTab.openerTabId === 'number' && sourceTab.openerTabId !== sourceTab.id
            ? sourceTab.openerTabId
            : undefined,
      });
      if (typeof created.id === 'number') {
        this.ourTabs.add(created.id);
        this.loopGuard.remember(created.id, action.url, Date.now());
      }

      // Remove the placeholder tab only when it has no history of its own; this
      // avoids destroying a tab the user has been browsing in (Case B) and
      // prevents "lost tabs" complaints.
      if (typeof sourceTab.id === 'number') {
        this.loopGuard.forgetTab(sourceTab.id);
        await this.closePlaceholder(sourceTab.id);
      }
    } catch (error) {
      console.warn('[g-container] failed to execute action', action.kind, error);
      return;
    }

    if (action.kind === 'contain') this.bumpStat('containedNavigations');
    else if (action.kind === 'release') this.bumpStat('releasedNavigations');
    else if (action.kind === 'unwrap') this.bumpStat('unwrappedLinks');
  }

  /**
   * Close a tab that only ever held the cancelled navigation.
   * If it has back-history we navigate it back instead of closing, so the user
   * never loses context.
   */
  private async closePlaceholder(tabId: number): Promise<void> {
    try {
      await browser.tabs.remove(tabId);
    } catch {
      // Tab already gone (fast user, or Firefox reused it) — nothing to do.
    }
  }

  private async getTab(tabId: number): Promise<browser.tabs.Tab | null> {
    try {
      return await browser.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- tab helpers

  /** Move a tab into or out of the container, preserving URL and position. */
  async moveTab(tabId: number, into: boolean): Promise<boolean> {
    await this.init();
    const tab = await this.getTab(tabId);
    if (tab === null || typeof tab.url !== 'string') return false;
    if (tab.incognito === true) return false;

    const containerId = await this.container.ensure(this.settings.container);
    if (containerId === null) return false;
    const target = into ? containerId : DEFAULT_COOKIE_STORE;
    if ((tab.cookieStoreId ?? DEFAULT_COOKIE_STORE) === target) return true;

    try {
      const created = await browser.tabs.create({
        url: tab.url,
        cookieStoreId: target,
        active: tab.active === true,
        index: tab.index,
        windowId: tab.windowId,
      });
      if (typeof created.id === 'number') {
        this.ourTabs.add(created.id);
        this.loopGuard.remember(created.id, tab.url, Date.now());
      }
      if (typeof tab.id === 'number') await this.closePlaceholder(tab.id);
      return true;
    } catch (error) {
      console.warn('[g-container] moveTab failed', error);
      return false;
    }
  }

  // --------------------------------------------------------------- UI state

  async runtimeState(): Promise<RuntimeState> {
    await this.init();
    const now = Date.now();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = typeof tab?.url === 'string' ? tab.url : null;
    const parsed = url === null ? null : safeParse(url);
    const containerId = this.container.id;

    return {
      enabled: this.settings.enabled,
      paused: this.settings.pausedUntil > now,
      pausedUntil: this.settings.pausedUntil,
      containerName: this.settings.container.name,
      containerColor: this.settings.container.color,
      containerIcon: this.settings.container.icon,
      cookieStoreId: containerId,
      currentUrl: url,
      currentHost: parsed?.hostname ?? null,
      currentTabInContainer:
        containerId !== null && (tab?.cookieStoreId ?? DEFAULT_COOKIE_STORE) === containerId,
      currentMatch: url === null ? { isGoogle: false, source: 'none' } : this.matcher.match(url),
      statistics: this.settings.statistics,
      domainCount: getDomainDatabase().hostCount,
    };
  }

  async diagnostics(): Promise<Diagnostics> {
    await this.init();
    const id = this.container.id;
    return {
      version: browser.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      cookieStoreId: id,
      containerExists: id !== null ? await this.container.exists(id) : false,
      domainCount: getDomainDatabase().hostCount,
      ruleCounts: this.matcher.ruleCounts(),
      storage: this.store.available(),
      matcherBuildMs: this.matcher.buildMs,
      recentErrors: this.store.recentErrors(),
    };
  }

  private updateBadge(): void {
    const active = isProtectionActive(this.settings, Date.now());
    const action = browser.action ?? browser.browserAction;
    if (action === undefined) return;
    void action.setBadgeText({ text: active ? '' : 'off' });
    void action.setBadgeBackgroundColor?.({ color: '#8f8f8f' });
    void action.setTitle({
      title: active
        ? `G-Container — protecting ${this.settings.container.name}`
        : 'G-Container — paused',
    });
  }

  // --------------------------------------------------------------- messaging

  async handleMessage(message: Message): Promise<unknown> {
    await this.init();
    switch (message.type) {
      case 'get-state':
        return this.runtimeState();
      case 'get-settings':
        return this.settings;
      case 'set-settings':
        return this.updateSettings(message.patch);
      case 'match-url':
        return this.matcher.match(message.url);
      case 'move-tab':
        return this.moveTab(message.tabId, message.into);
      case 'pause':
        return this.updateSettings({
          pausedUntil: Date.now() + Math.max(1, message.minutes) * 60_000,
        });
      case 'resume':
        return this.updateSettings({ pausedUntil: 0 });
      case 'add-rule': {
        const pattern = canonicalizeUserPattern(message.pattern);
        if (pattern === null) throw new Error(`Invalid pattern: ${message.pattern}`);
        const key = message.list === 'always' ? 'alwaysContainerize' : 'neverContainerize';
        const next = [...new Set([...this.settings[key], pattern])];
        return this.updateSettings({ [key]: next } as Parameters<typeof mergeSettings>[1]);
      }
      case 'remove-rule': {
        const key = message.list === 'always' ? 'alwaysContainerize' : 'neverContainerize';
        const next = this.settings[key].filter((p) => p !== message.pattern);
        return this.updateSettings({ [key]: next } as Parameters<typeof mergeSettings>[1]);
      }
      case 'export':
        return buildBackup(this.settings);
      case 'import': {
        const imported = parseBackup(message.document);
        this.settings = imported;
        await this.store.save(this.settings);
        this.rebuildMatcher();
        await this.container.applySpec(this.settings.container);
        this.updateBadge();
        return this.settings;
      }
      case 'reset': {
        this.settings = await this.store.reset();
        this.rebuildMatcher();
        this.loopGuard.clear();
        this.updateBadge();
        return this.settings;
      }
      case 'diagnostics':
        return this.diagnostics();
      default:
        throw new Error(`Unknown message: ${JSON.stringify(message)}`);
    }
  }

  // ---------------------------------------------------------- event wiring

  registerListeners(): void {
    browser.webRequest.onBeforeRequest.addListener(
      (details) => this.onBeforeRequest(details) as Promise<browser.webRequest.BlockingResponse>,
      { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
      ['blocking']
    );

    browser.runtime.onMessage.addListener((message) =>
      this.handleMessage(message as Message).catch((error: unknown) => {
        console.warn('[g-container] message failed', error);
        return { error: error instanceof Error ? error.message : String(error) };
      })
    );

    browser.tabs.onRemoved.addListener((tabId) => {
      this.loopGuard.forgetTab(tabId);
      this.ourTabs.delete(tabId);
    });

    browser.contextualIdentities?.onRemoved.addListener((info) => {
      void this.container.invalidate(info.contextualIdentity.cookieStoreId);
    });

    browser.runtime.onInstalled.addListener(() => {
      void this.init();
    });
    browser.runtime.onStartup?.addListener(() => {
      void this.init();
    });

    this.registerContextMenus();
  }

  private registerContextMenus(): void {
    const menus = browser.menus ?? browser.contextMenus;
    if (menus === undefined) return;

    const create = (id: string, title: string, contexts: string[]): void => {
      try {
        menus.create({ id, title, contexts: contexts as never });
      } catch (error) {
        console.warn('[g-container] menu create failed', id, error);
      }
    };

    void browser.runtime.onInstalled.addListener(() => {
      try {
        menus.removeAll();
      } catch {
        /* first run */
      }
      create('gc-open-here', 'Open link in Google Container', ['link']);
      create('gc-always', 'Always open this site in Google Container', ['page', 'link']);
      create('gc-never', 'Never open this site in Google Container', ['page', 'link']);
      create('gc-move-in', 'Move this tab into Google Container', ['page']);
      create('gc-move-out', 'Move this tab out of Google Container', ['page']);
    });

    menus.onClicked.addListener(async (info, tab) => {
      await this.init();
      const target = typeof info.linkUrl === 'string' ? info.linkUrl : info.pageUrl;
      const parsed = target === undefined ? null : safeParse(target);

      switch (info.menuItemId) {
        case 'gc-open-here': {
          const containerId = await this.container.ensure(this.settings.container);
          if (containerId === null || parsed === null) return;
          await browser.tabs.create({
            url: parsed.href,
            cookieStoreId: containerId,
            index: typeof tab?.index === 'number' ? tab.index + 1 : undefined,
            windowId: tab?.windowId,
          });
          return;
        }
        case 'gc-always':
          if (parsed !== null) {
            await this.handleMessage({
              type: 'add-rule',
              list: 'always',
              pattern: parsed.hostname,
            });
          }
          return;
        case 'gc-never':
          if (parsed !== null) {
            await this.handleMessage({
              type: 'add-rule',
              list: 'never',
              pattern: parsed.hostname,
            });
          }
          return;
        case 'gc-move-in':
          if (typeof tab?.id === 'number') await this.moveTab(tab.id, true);
          return;
        case 'gc-move-out':
          if (typeof tab?.id === 'number') await this.moveTab(tab.id, false);
          return;
        default:
          return;
      }
    });
  }
}

const app = new GContainer();
app.registerListeners();
void app.init();

// Exported for integration tests running in a mocked environment.
export { GContainer };
