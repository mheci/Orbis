/**
 * Background worker integration tests.
 *
 * The pure core was already well covered, but the adapter that actually calls
 * the WebExtension API was not tested at all — and that is precisely where
 * real-browser behaviour bites: tabs that vanish mid-operation, containers that
 * cannot be created, message handlers that must not throw across the boundary.
 *
 * These tests drive the real `Orbis` class against a behavioural mock of
 * Firefox, exercising the full path from a webRequest event to a created tab.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockBrowser } from './mock-browser.js';
import type {
  AddRulesResult,
  Diagnostics,
  MatchResult,
  Message,
  RuntimeState,
  Settings,
} from '../src/types/index.js';

/** `handleMessage` is intentionally typed `unknown`; narrow it in tests. */
type App = {
  init(): Promise<void>;
  onBeforeRequest(
    d: browser.webRequest._OnBeforeRequestDetails
  ): Promise<browser.webRequest.BlockingResponse | undefined>;
  handleMessage(m: Message): Promise<unknown>;
  moveActiveTab(into: boolean): Promise<boolean>;
  togglePause(): Promise<boolean>;
};
const ask = async <T>(app: App, message: Message): Promise<T> =>
  (await app.handleMessage(message)) as T;

const CONTAINER_NAME = 'Orbis';

/**
 * Install the mock, then load the background module fresh.
 *
 * `resetModules` is required because `src/background/index.ts` instantiates a
 * singleton and registers listeners at import time; without it the second test
 * would reuse the first test's worker and its already-populated caches.
 */
async function loadApp(mock: MockBrowser) {
  mock.install();
  vi.resetModules();
  const module = await import('../src/background/index.js');
  const app = new module.Orbis();
  await app.init();
  return app;
}

/**
 * Build a webRequest details object with every field Firefox actually supplies.
 * Using the real shape (rather than a convenient subset) means the adapter is
 * typechecked against the genuine API contract.
 */
let requestCounter = 0;
function details(
  url: string,
  tabId: number,
  type: browser.webRequest.ResourceType = 'main_frame'
): browser.webRequest._OnBeforeRequestDetails {
  return {
    url,
    tabId,
    type,
    frameId: 0,
    parentFrameId: -1,
    requestId: String(++requestCounter),
    method: 'GET',
    timeStamp: Date.now(),
    thirdParty: false,
    originUrl: undefined,
    documentUrl: undefined,
    incognito: false,
    cookieStoreId: 'firefox-default',
  } as browser.webRequest._OnBeforeRequestDetails;
}

const mainFrame = (url: string, tabId: number) => details(url, tabId, 'main_frame');

describe('background: containment path', () => {
  let mock: MockBrowser;

  beforeEach(() => {
    mock = new MockBrowser();
  });

  afterEach(() => {
    MockBrowser.uninstall();
  });

  it('creates the container on first init', async () => {
    await loadApp(mock);
    const identities = [...mock.identities.values()];
    expect(identities).toHaveLength(1);
    expect(identities[0]!.name).toBe(CONTAINER_NAME);
  });

  it('cancels a Google navigation and reopens it in the container', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'about:blank', active: true, index: 3 });

    const result = await app.onBeforeRequest(mainFrame('https://mail.google.com/', tab.id));

    expect(result).toEqual({ cancel: true });
    expect(mock.createdTabs).toHaveLength(1);
    const created = mock.createdTabs[0]!;
    expect(created.url).toBe('https://mail.google.com/');
    expect(created.cookieStoreId).toMatch(/^firefox-container-/);
    // Position and focus must be preserved or the user loses their place.
    expect(created.index).toBe(3);
    expect(created.active).toBe(true);
    // The placeholder tab is closed only after the replacement exists.
    expect(mock.removedTabIds).toEqual([tab.id]);
  });

  it('leaves a non-Google navigation completely untouched', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab();
    const result = await app.onBeforeRequest(mainFrame('https://example.com/', tab.id));
    expect(result).toBeUndefined();
    expect(mock.createdTabs).toHaveLength(0);
    expect(mock.removedTabIds).toHaveLength(0);
  });

  it('does not re-containerize a tab already in the container', async () => {
    const app = await loadApp(mock);
    const containerId = [...mock.identities.keys()][0]!;
    const tab = mock.addTab({ cookieStoreId: containerId });
    const result = await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));
    expect(result).toBeUndefined();
    expect(mock.createdTabs).toHaveLength(0);
  });

  it('releases a non-Google page opened inside the container', async () => {
    const app = await loadApp(mock);
    const containerId = [...mock.identities.keys()][0]!;
    const tab = mock.addTab({ cookieStoreId: containerId });

    const result = await app.onBeforeRequest(mainFrame('https://example.com/page', tab.id));

    expect(result).toEqual({ cancel: true });
    expect(mock.createdTabs[0]!.cookieStoreId).toBe('firefox-default');
  });

  it('ignores sub-resource requests entirely', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab();
    const result = await app.onBeforeRequest(
      details('https://www.google.com/script.js', tab.id, 'script')
    );
    expect(result).toBeUndefined();
    expect(mock.createdTabs).toHaveLength(0);
  });

  it('ignores requests with no associated tab (tabId -1)', async () => {
    const app = await loadApp(mock);
    const result = await app.onBeforeRequest(mainFrame('https://www.google.com/', -1));
    expect(result).toBeUndefined();
  });
});

describe('background: resilience', () => {
  let mock: MockBrowser;

  beforeEach(() => {
    mock = new MockBrowser();
  });
  afterEach(() => {
    MockBrowser.uninstall();
  });

  it('survives the tab disappearing before it can be read', async () => {
    const app = await loadApp(mock);
    // tabId refers to a tab that no longer exists — tabs.get will reject.
    const result = await app.onBeforeRequest(mainFrame('https://www.google.com/', 9999));
    expect(result).toBeUndefined();
  });

  it('fails OPEN when the replacement tab cannot be created', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab();
    mock.failNextCreates = 1;

    const result = await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));

    // Containment is best-effort. If we cannot produce the replacement tab, the
    // original navigation must be allowed through — cancelling it would strand
    // the user on a blank dead tab, which is a far worse failure than briefly
    // loading a Google page uncontained.
    expect(result).toBeUndefined();
    expect(mock.tabsById.has(tab.id)).toBe(true);
    expect(mock.removedTabIds).not.toContain(tab.id);
  });

  it('recovers on the next attempt after a transient create failure', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab();
    mock.failNextCreates = 1;

    await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));
    // A transient failure must not poison the loop guard and suppress the
    // retry, so the very next identical navigation should containerize.
    const second = await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));

    expect(second).toEqual({ cancel: true });
    expect(mock.createdTabs).toHaveLength(1);
    expect(mock.createdTabs[0]!.cookieStoreId).toMatch(/^firefox-container-/);
  });

  it('does nothing when containers are unavailable', async () => {
    mock.failIdentityCreate = true;
    const app = await loadApp(mock);
    const tab = mock.addTab();
    const result = await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));
    expect(result).toBeUndefined();
    expect(mock.createdTabs).toHaveLength(0);
  });

  it('recreates the container after the user deletes it', async () => {
    const app = await loadApp(mock);
    const firstId = [...mock.identities.keys()][0]!;

    mock.identities.delete(firstId);
    await app.handleMessage({ type: 'get-state' });
    // Simulate Firefox's onRemoved event.
    const tab = mock.addTab();
    await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));

    const remaining = [...mock.identities.values()];
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    expect(remaining.some((i) => i.name === CONTAINER_NAME)).toBe(true);
  });

  it('does not act twice on the same tab and url (loop guard)', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab();

    await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));
    const createdAfterFirst = mock.createdTabs.length;
    // Same tab id, same URL, immediately again.
    await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id));

    expect(mock.createdTabs.length).toBe(createdAfterFirst);
  });
});

describe('background: messaging contract', () => {
  let mock: MockBrowser;

  beforeEach(() => {
    mock = new MockBrowser();
  });
  afterEach(() => {
    MockBrowser.uninstall();
  });

  it('returns a coherent runtime state for the popup', async () => {
    const app = await loadApp(mock);
    mock.addTab({ url: 'https://mail.google.com/', active: true });
    const state = await ask<RuntimeState>(app, { type: 'get-state' });

    expect(state.enabled).toBe(true);
    expect(state.paused).toBe(false);
    expect(state.containerName).toBe(CONTAINER_NAME);
    expect(state.currentHost).toBe('mail.google.com');
    expect(state.currentMatch.isGoogle).toBe(true);
    expect(state.domainCount).toBeGreaterThan(600);
  });

  it('persists a settings patch and rebuilds the matcher', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'add-rule', list: 'never', pattern: 'docs.google.com' });
    const match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://docs.google.com/document/d/1',
    });
    expect(match.isGoogle).toBe(false);
  });

  it('renames the container in place without recreating it', async () => {
    const app = await loadApp(mock);
    const idBefore = [...mock.identities.keys()][0]!;

    await app.handleMessage({ type: 'set-settings', patch: { container: { name: 'Big G' } } });

    expect(mock.identities.size).toBe(1);
    expect(mock.identities.get(idBefore)!.name).toBe('Big G');
  });

  it('pause stops containment and resume restores it', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'pause', minutes: 30 });

    const tab = mock.addTab();
    expect(await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id))).toBeUndefined();

    await app.handleMessage({ type: 'resume' });
    const tab2 = mock.addTab();
    expect(await app.onBeforeRequest(mainFrame('https://www.google.com/', tab2.id))).toEqual({
      cancel: true,
    });
  });

  it('export/import survives a round trip through the worker', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'add-rule', list: 'always', pattern: 'intranet.example.com' });
    const backup = await ask<unknown>(app, { type: 'export' });

    await app.handleMessage({ type: 'reset' });
    let match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://intranet.example.com/',
    });
    expect(match.isGoogle).toBe(false);

    await app.handleMessage({ type: 'import', document: JSON.parse(JSON.stringify(backup)) });
    match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://intranet.example.com/',
    });
    expect(match.isGoogle).toBe(true);
  });

  it('rejects an unknown message rather than failing silently', async () => {
    const app = await loadApp(mock);
    await expect(app.handleMessage({ type: 'nope' } as never)).rejects.toThrow(/Unknown message/);
  });

  it('moves the active tab into the container and back out', async () => {
    const app = await loadApp(mock);
    const containerId = [...mock.identities.keys()][0]!;
    mock.addTab({ url: 'https://example.com/', active: true });

    expect(await app.moveActiveTab(true)).toBe(true);
    expect(mock.createdTabs[0]!.cookieStoreId).toBe(containerId);
    expect(mock.createdTabs[0]!.active).toBe(true);

    mock.addTab({ url: 'https://www.google.com/', active: true, cookieStoreId: containerId });
    expect(await app.moveActiveTab(false)).toBe(true);
    expect(mock.createdTabs[1]!.cookieStoreId).toBe('firefox-default');
  });

  it('togglePause flips protection on and off', async () => {
    const app = await loadApp(mock);
    expect(await app.togglePause()).toBe(true);
    const tab = mock.addTab();
    expect(await app.onBeforeRequest(mainFrame('https://www.google.com/', tab.id))).toBeUndefined();

    expect(await app.togglePause()).toBe(false);
    const tab2 = mock.addTab();
    expect(await app.onBeforeRequest(mainFrame('https://www.google.com/', tab2.id))).toEqual({
      cancel: true,
    });
  });

  it('rejects an invalid rule pattern', async () => {
    const app = await loadApp(mock);
    await expect(
      app.handleMessage({ type: 'add-rule', list: 'never', pattern: 'javascript:alert(1)' })
    ).rejects.toThrow(/Invalid pattern/);
  });

  it('bulk-adds patterns: canonicalizes, dedupes and reports nothing invalid', async () => {
    const app = await loadApp(mock);
    const result = await ask<AddRulesResult>(app, {
      type: 'add-rules',
      list: 'always',
      patterns: ['Intranet.Example.com', 'docs.example.com', 'docs.example.com', 'ftp.example.com'],
    });

    expect(result.invalid).toEqual([]);
    expect(result.settings.alwaysContainerize).toEqual([
      'intranet.example.com',
      'docs.example.com',
      'ftp.example.com',
    ]);
    const match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://docs.example.com/x',
    });
    expect(match.isGoogle).toBe(true);
  });

  it('bulk-add keeps the valid entries and reports the invalid ones', async () => {
    const app = await loadApp(mock);
    const result = await ask<AddRulesResult>(app, {
      type: 'add-rules',
      list: 'never',
      patterns: [
        'javascript:alert(1)',
        'mail.example.com',
        '',
        'docs.google.com',
        'docs.google.com',
      ],
    });

    expect(result.invalid).toEqual(['javascript:alert(1)', '']);
    expect(result.settings.neverContainerize).toEqual(['mail.example.com', 'docs.google.com']);
    const match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://docs.google.com/x',
    });
    expect(match.isGoogle).toBe(false);
  });

  it('single add-rule still throws on invalid input (API unchanged)', async () => {
    const app = await loadApp(mock);
    await expect(
      app.handleMessage({ type: 'add-rule', list: 'always', pattern: 'javascript:alert(1)' })
    ).rejects.toThrow(/Invalid pattern/);
    const result = await ask<Settings>(app, {
      type: 'add-rule',
      list: 'always',
      pattern: 'intranet.example.com',
    });
    expect(result.alwaysContainerize).toContain('intranet.example.com');
  });

  it('applies exceptions and keeps disabled ones inert', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({
      type: 'set-exceptions',
      exceptions: [
        { pattern: 'docs.google.com', enabled: true, created: 1 },
        { pattern: 'drive.google.com', note: 'work files', enabled: false, created: 2 },
      ],
    });

    let match = await ask<MatchResult>(app, {
      type: 'match-url',
      url: 'https://docs.google.com/x',
    });
    expect(match.isGoogle).toBe(false);
    expect(match.source).toBe('exception');

    // Disabled exceptions are ignored by the matcher.
    match = await ask<MatchResult>(app, { type: 'match-url', url: 'https://drive.google.com/x' });
    expect(match.isGoogle).toBe(true);
  });

  it('rejects invalid exception patterns silently but keeps the rest', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({
      type: 'set-exceptions',
      exceptions: [
        { pattern: 'docs.google.com', enabled: true, created: 1 },
        { pattern: 'javascript:alert(1)', enabled: true, created: 2 },
        { pattern: 'docs.google.com', enabled: true, created: 3 },
      ],
    });
    const settings = await ask<Settings>(app, { type: 'get-settings' });
    expect(settings.exceptions).toHaveLength(1);
    expect(settings.exceptions[0]!.pattern).toBe('docs.google.com');
  });

  it('produces diagnostics without leaking browsing data', async () => {
    const app = await loadApp(mock);
    mock.addTab({ url: 'https://secret.example.com/private', active: true });
    const diagnostics = await ask<Diagnostics>(app, { type: 'diagnostics' });
    const serialised = JSON.stringify(diagnostics);
    expect(serialised).not.toContain('secret.example.com');
    expect(diagnostics.domainCount).toBeGreaterThan(600);
    expect(diagnostics.containerExists).toBe(true);
  });
});

describe('background: settings persistence across a restart', () => {
  it('reloads user rules after the event page is suspended and revived', async () => {
    const mock = new MockBrowser();
    const first = await loadApp(mock);
    await first.handleMessage({ type: 'add-rule', list: 'never', pattern: 'docs.google.com' });
    MockBrowser.uninstall();

    // Same storage, brand new worker instance — this is what an MV3 suspend and
    // wake-up looks like.
    const second = await loadApp(mock);
    const match = await ask<MatchResult>(second, {
      type: 'match-url',
      url: 'https://docs.google.com/x',
    });
    expect(match.isGoogle).toBe(false);
    MockBrowser.uninstall();
  });

  it('reuses the existing container instead of creating a second one', async () => {
    const mock = new MockBrowser();
    await loadApp(mock);
    MockBrowser.uninstall();
    expect(mock.identities.size).toBe(1);

    await loadApp(mock);
    expect(mock.identities.size).toBe(1);
    MockBrowser.uninstall();
  });
});

describe('background: blocking Google resources on other websites', () => {
  let mock: MockBrowser;

  beforeEach(() => {
    mock = new MockBrowser();
  });
  afterEach(() => {
    MockBrowser.uninstall();
  });

  function sub(url: string, tabId: number, origin: string, type = 'script') {
    return {
      ...details(url, tabId, type as browser.webRequest.ResourceType),
      originUrl: origin,
    } as browser.webRequest._OnBeforeRequestDetails;
  }

  it('blocks Google Analytics embedded in an ordinary website', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    const result = app.onBeforeSubresource(
      sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
    );
    expect(result).toEqual({ cancel: true });
  });

  it('lets Google Fonts through so pages still render', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    const result = app.onBeforeSubresource(
      sub('https://fonts.googleapis.com/css2?family=Inter', tab.id, 'https://news.example.com/')
    );
    expect(result).toBeUndefined();
  });

  it('counts blocked resources per tab and shows them on the icon', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    for (const url of [
      'https://www.google-analytics.com/analytics.js',
      'https://www.googletagmanager.com/gtm.js',
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    ]) {
      app.onBeforeSubresource(sub(url, tab.id, 'https://news.example.com/'));
    }
    expect(await app.handleMessage({ type: 'get-blocked', tabId: tab.id })).toBe(3);
    expect(mock.badgeByTab.get(tab.id)).toBe('3');
  });

  it('resets the count when the tab navigates somewhere new', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    app.onBeforeSubresource(
      sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
    );
    expect(await app.handleMessage({ type: 'get-blocked', tabId: tab.id })).toBe(1);

    app.onBeforeSubresource(details('https://other.example.com/', tab.id, 'main_frame'));
    expect(await app.handleMessage({ type: 'get-blocked', tabId: tab.id })).toBe(0);
  });

  it('blocks nothing when the mode is off', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'set-settings', patch: { blocking: { mode: 'off' } } });
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    const result = app.onBeforeSubresource(
      sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
    );
    expect(result).toBeUndefined();
  });

  it('blocks nothing while protection is paused', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'pause', minutes: 30 });
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    expect(
      app.onBeforeSubresource(
        sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
      )
    ).toBeUndefined();
  });

  it('honours a site the user has allowlisted', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'allowlist-site', host: 'news.example.com', allow: true });
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    expect(
      app.onBeforeSubresource(
        sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
      )
    ).toBeUndefined();
  });

  it('returns synchronously, never a promise', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/' });
    const result = app.onBeforeSubresource(
      sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
    );
    // A blocking webRequest listener that returns a promise stalls the request
    // until it settles, which would add latency to every page on the web.
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('reports blocked counts and mode in the popup state', async () => {
    const app = await loadApp(mock);
    const tab = mock.addTab({ url: 'https://news.example.com/', active: true });
    app.onBeforeSubresource(
      sub('https://www.google-analytics.com/analytics.js', tab.id, 'https://news.example.com/')
    );
    const state = await ask<RuntimeState>(app, { type: 'get-state' });
    expect(state.blockedHere).toBe(1);
    expect(state.blockingMode).toBe('standard');
    expect(state.siteAllowlisted).toBe(false);
  });
});
