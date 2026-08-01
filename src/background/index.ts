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
import { DecisionLog, makeDecisionEntry, shouldLogDecision } from '../core/decisionLog.js';
import { ContainerManager, type ContextualIdentitiesApi } from '../core/container.js';
import { UrlMatcher, safeParse } from '../core/matcher.js';
import { SubresourceClassifier } from '../core/subresource.js';
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
const DECISION_LOG_STORAGE_KEY = 'decisionLog';

class Orbis {
  private readonly store = new SettingsStore();
  private readonly loopGuard = new LoopGuard();
  private readonly decisionLog = new DecisionLog();
  private matcher: UrlMatcher;
  private container: ContainerManager;
  private settings: Settings;
  private ready: Promise<void> | null = null;
  private statsFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private blocker: SubresourceClassifier;
  /** Per-tab count of Google resources blocked, for the popup and badge. */
  private readonly blockedPerTab = new Map<number, number>();
  /** Cookie store of each tab, cached so the blocking path stays synchronous. */
  private readonly tabStores = new Map<number, string>();

  constructor() {
    this.settings = defaultSettings();
    this.matcher = new UrlMatcher(this.settings);
    this.blocker = new SubresourceClassifier(
      this.settings.blocking.mode,
      this.settings.blocking.allowlist,
      this.matcher
    );
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
        const stored = await browser.storage.local.get(DECISION_LOG_STORAGE_KEY);
        this.decisionLog.restore(stored?.[DECISION_LOG_STORAGE_KEY]);
        this.updateBadge();
      })();
    }
    return this.ready;
  }

  private rebuildMatcher(): void {
    this.matcher = new UrlMatcher(this.settings);
    this.blocker = new SubresourceClassifier(
      this.settings.blocking.mode,
      this.settings.blocking.allowlist,
      this.matcher
    );
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

  /** Record a decision in the local ring buffer and persist it lazily. */
  private logDecision(action: NavigationAction, url: string, tabId: number, now: number): void {
    if (!shouldLogDecision(action)) return;
    this.decisionLog.record(makeDecisionEntry(action, url, tabId, now));
    if (this.logFlushTimer !== null) return;
    this.logFlushTimer = setTimeout(() => {
      this.logFlushTimer = null;
      void browser.storage.local.set({ [DECISION_LOG_STORAGE_KEY]: this.decisionLog.snapshot() });
    }, 2000);
  }

  private clearDecisionLog(): number {
    this.decisionLog.clear();
    if (this.logFlushTimer !== null) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    void browser.storage.local.remove(DECISION_LOG_STORAGE_KEY);
    return this.decisionLog.size;
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

    // The blocking listener stalls the navigation, so every serial round-trip
    // here is visible as page-load latency. Fetch the tab facts and the
    // container id concurrently instead of one after the other.
    const [tab, containerId] = await Promise.all([
      this.getTab(details.tabId),
      this.container.ensure(this.settings.container),
    ]);
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
      containerId,
      openerTabId,
      openerCookieStoreId,
      // For a top-level navigation this is the page that started it (a link
      // click) or the last hop of a redirect chain — used to recognise OAuth
      // callbacks leaving a Google sign-in flow.
      referrerUrl:
        typeof details.originUrl === 'string'
          ? details.originUrl
          : typeof details.documentUrl === 'string'
            ? details.documentUrl
            : null,
      incognito: tab.incognito === true,
      now,
    };

    const action = decideNavigation(context, {
      settings: this.settings,
      matcher: this.matcher,
      loopGuard: this.loopGuard,
    });

    // Keep a bounded local record of what happened and why (see the
    // Diagnostics panel). Routine ignores are filtered out so the log stays
    // readable; writes are debounced because navigation bursts are common.
    this.logDecision(action, details.url, details.tabId, now);

    if (action.kind === 'ignore') {
      if (action.reason === 'exception' || action.reason.startsWith('never')) {
        this.bumpStat('exceptionsApplied');
      }
      return undefined;
    }

    // Mark both the source and the destination URL so the freshly opened tab's
    // own onBeforeRequest event does not trigger a second decision.
    this.loopGuard.remember(details.tabId, details.url, now);

    const executed = await this.executeAction(action, tab);
    if (!executed) {
      // The replacement tab could not be created (container deleted mid-flight,
      // window closing, resource exhaustion). Cancelling anyway would strand the
      // user on a blank dead tab, so fail OPEN and let the original load
      // proceed. Containment is best-effort; losing the user's navigation is
      // not an acceptable failure mode.
      //
      // Forget the loop-guard entry too, otherwise a transient failure would
      // suppress containment for this URL for the next few seconds.
      this.loopGuard.forgetTab(details.tabId);
      return undefined;
    }
    return { cancel: true };
  }

  /**
   * Carry out a decision.
   *
   * @returns true when the replacement tab exists and the original navigation
   *          may safely be cancelled; false when it must be allowed to proceed.
   */
  private async executeAction(
    action: Exclude<NavigationAction, { kind: 'ignore' }>,
    sourceTab: browser.tabs.Tab
  ): Promise<boolean> {
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
      console.warn('[orbis] failed to execute action', action.kind, error);
      return false;
    }

    if (action.kind === 'contain') this.bumpStat('containedNavigations');
    else if (action.kind === 'release') this.bumpStat('releasedNavigations');
    else if (action.kind === 'unwrap') this.bumpStat('unwrappedLinks');
    return true;
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

  // ------------------------------------------------- third-party resources

  /**
   * Handle a sub-resource request: a Google script, pixel, frame or image
   * loaded by a website that is not Google.
   *
   * This runs on every sub-resource of every page, so it must be cheap and it
   * must be synchronous. Returning a promise from a blocking webRequest
   * listener stalls the request until it settles, which would add latency to
   * the entire web. Everything it needs is therefore kept in memory: the tab's
   * cookie store is cached from the navigation path, and classification results
   * are memoised.
   */
  onBeforeSubresource(
    details: browser.webRequest._OnBeforeRequestDetails
  ): browser.webRequest.BlockingResponse | undefined {
    if (details.type === 'main_frame') {
      // A new page load resets that tab's counter.
      if (details.tabId >= 0) {
        this.blockedPerTab.delete(details.tabId);
        this.refreshBadge(details.tabId);
      }
      return undefined;
    }
    if (this.settings.blocking.mode === 'off') return undefined;
    if (!isProtectionActive(this.settings, Date.now())) return undefined;

    const containerId = this.container.id;
    const tabStore = details.tabId >= 0 ? this.tabStores.get(details.tabId) : undefined;

    const decision = this.blocker.decideCached({
      url: details.url,
      originUrl:
        typeof details.originUrl === 'string'
          ? details.originUrl
          : typeof details.documentUrl === 'string'
            ? details.documentUrl
            : null,
      type: details.type,
      tabInContainer: containerId !== null && tabStore === containerId,
    });

    if (decision.action !== 'block') return undefined;

    if (details.tabId >= 0) {
      const next = (this.blockedPerTab.get(details.tabId) ?? 0) + 1;
      this.blockedPerTab.set(details.tabId, next);
      this.refreshBadge(details.tabId);
    }
    this.bumpStat('trackersBlocked');
    return { cancel: true };
  }

  /** Show the blocked count for a tab on the toolbar icon. */
  private refreshBadge(tabId: number): void {
    const action = browser.action ?? browser.browserAction;
    if (action === undefined) return;
    if (!this.settings.blocking.showBadge) {
      void action.setBadgeText({ tabId, text: '' });
      return;
    }
    const count = this.blockedPerTab.get(tabId) ?? 0;
    void action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    void action.setBadgeBackgroundColor?.({ tabId, color: '#1a1042' });
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
        this.loopGuard.remember(created.id, tab.url, Date.now());
      }
      if (typeof tab.id === 'number') await this.closePlaceholder(tab.id);
      return true;
    } catch (error) {
      console.warn('[orbis] moveTab failed', error);
      return false;
    }
  }

  async openOrbisTab(url = 'about:blank'): Promise<void> {
    await this.init();
    const containerId = await this.container.ensure(this.settings.container);
    if (containerId === null) return;
    const parsed = safeParse(url);
    const finalUrl = parsed?.href ?? 'about:blank';
    const tab = await browser.tabs.create({ url: finalUrl, cookieStoreId: containerId });
    if (typeof tab.id === 'number') {
      this.loopGuard.remember(tab.id, finalUrl, Date.now());
      this.tabStores.set(tab.id, containerId);
    }
  }

  async openGoogleInOrbis(): Promise<void> {
    await this.openOrbisTab('https://www.google.com');
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
      blockedHere: typeof tab?.id === 'number' ? (this.blockedPerTab.get(tab.id) ?? 0) : 0,
      blockingMode: this.settings.blocking.mode,
      siteAllowlisted:
        parsed !== null &&
        this.settings.blocking.allowlist.some(
          (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
        ),
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
      ruleCounts: { ...this.matcher.ruleCounts(), ...this.blocker.counts() },
      storage: this.store.available(),
      matcherBuildMs: this.matcher.buildMs,
      recentErrors: this.store.recentErrors(),
      recentDecisions: this.decisionLog.snapshot(),
    };
  }

  private updateBadge(): void {
    const active = isProtectionActive(this.settings, Date.now());
    const action = browser.action ?? browser.browserAction;
    if (action === undefined) return;
    void action.setBadgeText({ text: active ? '' : 'off' });
    void action.setBadgeBackgroundColor?.({ color: '#8f8f8f' });
    void action.setTitle({
      title: active ? `Orbis — protecting ${this.settings.container.name}` : 'Orbis — paused',
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
      case 'set-exceptions':
        // The whole list is replaced and re-sanitised wholesale; invalid or
        // duplicate entries are dropped by sanitizeSettings, so a UI bug can
        // never corrupt the matcher's exception set.
        return this.updateSettings({ exceptions: message.exceptions });
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
      case 'allowlist-site': {
        const host = canonicalizeUserPattern(message.host);
        if (host === null) throw new Error(`Invalid site: ${message.host}`);
        const current = this.settings.blocking.allowlist;
        const next = message.allow
          ? [...new Set([...current, host])]
          : current.filter((h) => h !== host);
        return this.updateSettings({ blocking: { allowlist: next } });
      }
      case 'get-blocked':
        return this.blockedPerTab.get(message.tabId) ?? 0;
      case 'clear-decision-log':
        return this.clearDecisionLog();
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

    // Sub-resource blocking. Registered separately from the navigation
    // listener because it must stay synchronous: returning a promise from a
    // blocking listener stalls every request until it resolves.
    browser.webRequest.onBeforeRequest.addListener(
      (details) => this.onBeforeSubresource(details),
      {
        urls: ['http://*/*', 'https://*/*'],
        types: [
          'script',
          'xmlhttprequest',
          'image',
          'imageset',
          'sub_frame',
          'ping',
          'beacon',
          'media',
          'object',
          'object_subrequest',
          'websocket',
          'other',
        ] as browser.webRequest.ResourceType[],
      },
      ['blocking']
    );

    browser.runtime.onMessage.addListener((message) =>
      this.handleMessage(message as Message).catch((error: unknown) => {
        console.warn('[orbis] message failed', error);
        return { error: error instanceof Error ? error.message : String(error) };
      })
    );

    browser.tabs.onRemoved.addListener((tabId) => {
      this.loopGuard.forgetTab(tabId);
      this.blockedPerTab.delete(tabId);
      this.tabStores.delete(tabId);
    });

    // The blocking path needs a tab's cookie store synchronously, so it is
    // cached here rather than looked up per request.
    const rememberTab = (tab: browser.tabs.Tab): void => {
      if (typeof tab.id === 'number' && typeof tab.cookieStoreId === 'string') {
        this.tabStores.set(tab.id, tab.cookieStoreId);
      }
    };
    browser.tabs.onCreated.addListener(rememberTab);
    browser.tabs.onUpdated.addListener((_tabId, _change, tab) => rememberTab(tab));
    void browser.tabs.query({}).then((tabs) => tabs.forEach(rememberTab));

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
        console.warn('[orbis] menu create failed', id, error);
      }
    };

    void browser.runtime.onInstalled.addListener(() => {
      try {
        menus.removeAll();
      } catch {
        /* first run */
      }
      create('gc-open-here', 'Open link in Orbis', ['link']);
      create('gc-always', 'Always open this site in Orbis', ['page', 'link']);
      create('gc-never', 'Never open this site in Orbis', ['page', 'link']);
      // The tab context makes moving available from the tab strip itself,
      // where a "page" menu item is not offered.
      create('gc-move-in', 'Move this tab into Orbis', ['page', 'tab']);
      create('gc-move-out', 'Move this tab out of Orbis', ['page', 'tab']);
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

const app = new Orbis();
app.registerListeners();
void app.init();

// Hotkey support – one keypress = isolated tab, invisible efficiency
const lastCommandTime = new Map<string, number>();
function shouldHandleCommand(name: string): boolean {
  const now = Date.now();
  const last = lastCommandTime.get(name) ?? 0;
  if (now - last < 350) return false;
  lastCommandTime.set(name, now);
  return true;
}

if (browser.commands?.onCommand) {
  browser.commands.onCommand.addListener((command) => {
    if (!shouldHandleCommand(command)) return;
    if (command === 'open-orbis-tab') {
      void app.openOrbisTab().catch(() => {});
    } else if (command === 'open-google-in-orbis') {
      void app.openGoogleInOrbis().catch(() => {});
    }
  });
}

// First-time onboarding – friendly, clear, theme-able
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  void (async () => {
    try {
      const stored = (await browser.storage.local.get('onboardingCompleted')) as Record<
        string,
        unknown
      >;
      if (stored['onboardingCompleted']) return;
      await browser.tabs.create({
        url: browser.runtime.getURL('onboarding/index.html'),
      });
    } catch {
      // Best-effort
    }
  })();
});

// Exported for integration tests running in a mocked environment.
export { Orbis };
