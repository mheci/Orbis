/**
 * Time-boxed temporary allowances, end to end.
 *
 * The window must be enforced by data alone: the matcher compares `until`
 * against the clock on every call (no timer can be trusted to fire), expired
 * entries are pruned by the settings sanitizer, and the background adapter
 * exposes creation/removal plus the live countdown to the UI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideNavigation, DEFAULT_COOKIE_STORE, LoopGuard } from '../src/core/decision.js';
import { UrlMatcher } from '../src/core/matcher.js';
import { defaultSettings, mergeSettings, sanitizeSettings } from '../src/core/settings.js';
import { MockBrowser } from './mock-browser.js';
import type { Message, RuntimeState, Settings } from '../src/types/index.js';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...overrides } as Settings;
}

const FUTURE = Date.now() + 30 * 60_000;
const PAST = Date.now() - 60_000;

/** Busy-wait helper so short expiry windows really do lapse mid-test. */
function spinUntilElapsed(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

describe('matcher: temporary allowance tier', () => {
  it('suppresses containment for a Google host while the window is live', () => {
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'mail.google.com', until: FUTURE }],
    });
    const result = new UrlMatcher(settings).match('https://mail.google.com/inbox');
    expect(result).toEqual({
      isGoogle: false,
      source: 'temporary-allow',
      pattern: 'mail.google.com',
    });
  });

  it('matches subdomains of the allowed pattern but not lookalikes', () => {
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'google.com', until: FUTURE }],
    });
    const matcher = new UrlMatcher(settings);
    expect(matcher.match('https://docs.google.com/').source).toBe('temporary-allow');
    // evil.com is unrelated to Google entirely; the allowance must not claim it.
    expect(matcher.match('https://googl.evil.com/').source).not.toBe('temporary-allow');
  });

  it('resumes normal containment once the window lapses — same instance', () => {
    // Generous margins so the test is deterministic even on slow CI runners:
    // the first lookup must land inside a 200 ms window, then we busy-wait
    // past its end before asserting that containment resumes.
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'mail.google.com', until: Date.now() + 200 }],
    });
    const matcher = new UrlMatcher(settings);
    expect(matcher.match('https://mail.google.com/').source).toBe('temporary-allow');
    // The verdict must not be served from cache after expiry: temporary
    // results are never stored, so the next call re-evaluates against the
    // clock and returns to a plain Google match.
    spinUntilElapsed(250);
    const after = matcher.match('https://mail.google.com/');
    expect(after.isGoogle).toBe(true);
    expect(after.source).not.toBe('temporary-allow');
  });

  it('honours path-scoped allowances', () => {
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'google.com/search', until: FUTURE }],
    });
    const matcher = new UrlMatcher(settings);
    expect(matcher.match('https://www.google.com/search?q=x').source).toBe('temporary-allow');
    expect(matcher.match('https://www.google.com/mail').isGoogle).toBe(true);
  });

  it('ranks below an explicit Never rule but above exceptions and Always rules', () => {
    const settings = makeSettings({
      neverContainerize: ['a.google.com'],
      alwaysContainerize: ['b.google.com'],
      exceptions: [{ pattern: 'c.google.com', enabled: true, created: 1 }],
      temporaryAllowances: [
        { pattern: 'a.google.com', until: FUTURE },
        { pattern: 'b.google.com', until: FUTURE },
        { pattern: 'c.google.com', until: FUTURE },
      ],
    });
    const matcher = new UrlMatcher(settings);
    expect(matcher.match('https://a.google.com/').source).toBe('never-list');
    expect(matcher.match('https://b.google.com/').source).toBe('temporary-allow');
    expect(matcher.match('https://c.google.com/').source).toBe('temporary-allow');
  });

  it('reports unallowed non-Google URLs as plain none', () => {
    const settings = makeSettings();
    const result = new UrlMatcher(settings).match('https://example.com/page');
    expect(result.isGoogle).toBe(false);
    expect(result.source).toBe('none');
  });

  it('labels an allowance-covered host even when it is not Google-owned', () => {
    // Same reporting convention as Never rules: a deliberate user override
    // wins the label regardless of what the database would have said.
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'example.com', until: FUTURE }],
    });
    const result = new UrlMatcher(settings).match('https://example.com/page');
    expect(result.isGoogle).toBe(false);
    expect(result.source).toBe('temporary-allow');
  });

  it('never caches time-boxed verdicts', () => {
    const settings = makeSettings({
      temporaryAllowances: [{ pattern: 'mail.google.com', until: FUTURE }],
    });
    const matcher = new UrlMatcher(settings);
    matcher.match('https://mail.google.com/');
    const cache = (matcher as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBe(0);
  });
});

describe('engine: temporary allowances change decisions, not just labels', () => {
  const now = Date.now();
  const base = {
    url: 'https://mail.google.com/',
    tabId: 7,
    cookieStoreId: DEFAULT_COOKIE_STORE,
    containerId: 'firefox-container-1' as string | null,
    openerTabId: null,
    openerCookieStoreId: null,
    referrerUrl: null,
    incognito: false,
    now,
  };
  const allowed = () =>
    makeSettings({
      temporaryAllowances: [{ pattern: 'mail.google.com', until: now + 60_000 }],
    });

  it('ignores a Google navigation outside the container while allowed', () => {
    const settings = allowed();
    const action = decideNavigation(base, {
      settings,
      matcher: new UrlMatcher(settings),
      loopGuard: new LoopGuard(),
    });
    expect(action).toEqual({ kind: 'ignore', reason: 'not-google' });
  });

  it('releases a temporarily-allowed site out of the container (Case B2)', () => {
    const settings = allowed();
    const action = decideNavigation(
      { ...base, cookieStoreId: 'firefox-container-1' },
      {
        settings,
        matcher: new UrlMatcher(settings),
        loopGuard: new LoopGuard(),
      }
    );
    expect(action.kind).toBe('release');
  });

  it('still respects OAuth passthrough ordering when no allowance exists', () => {
    // Sanity guard: adding the tier did not disturb Case A containment.
    const action = decideNavigation(base, {
      settings: makeSettings(),
      matcher: new UrlMatcher(makeSettings()),
      loopGuard: new LoopGuard(),
    });
    expect(action.kind).toBe('contain');
  });
});

describe('settings: temporary allowance sanitation', () => {
  it('drops lapsed windows on sight', () => {
    const sanitized = sanitizeSettings({
      ...defaultSettings(),
      temporaryAllowances: [{ pattern: 'old.google.com', until: PAST }],
    });
    expect(sanitized.temporaryAllowances).toEqual([]);
  });

  it('canonicalises patterns, dedupes hosts keeping the longest window', () => {
    const sanitized = sanitizeSettings({
      ...defaultSettings(),
      temporaryAllowances: [
        { pattern: 'HTTPS://Mail.Google.com/', until: FUTURE + 1000 },
        { pattern: 'mail.google.com', until: FUTURE },
        { pattern: '!!!invalid!!!', until: FUTURE + 5000 },
      ],
    });
    expect(sanitized.temporaryAllowances).toEqual([
      { pattern: 'mail.google.com', until: FUTURE + 1000 },
    ]);
  });

  it('survives a round-trip through mergeSettings', () => {
    const merged = mergeSettings(defaultSettings(), {
      temporaryAllowances: [{ pattern: 'news.example.com', until: FUTURE }],
    });
    expect(merged.temporaryAllowances).toHaveLength(1);
    // A patch without the key leaves the list intact.
    const again = mergeSettings(merged, { enabled: false });
    expect(again.temporaryAllowances).toEqual(merged.temporaryAllowances);
  });
});

describe('background: temporary allowance messages, state and badge', () => {
  let mock: MockBrowser;

  type App = {
    init(): Promise<void>;
    handleMessage(m: Message): Promise<unknown>;
    onBeforeSubresource(
      d: browser.webRequest._OnBeforeRequestDetails
    ): browser.webRequest.BlockingResponse | undefined;
  };

  async function loadApp(instance: MockBrowser): Promise<App> {
    instance.install();
    vi.resetModules();
    const module = await import('../src/background/index.js');
    const app = new module.Orbis();
    await app.init();
    // Wire the tab caches (tabStores/tabUrls) exactly as the real worker does.
    (app as unknown as { registerListeners(): void }).registerListeners();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return app;
  }

  function scriptDetails(
    url: string,
    originUrl: string
  ): browser.webRequest._OnBeforeRequestDetails {
    return {
      url,
      tabId: 1,
      type: 'script',
      frameId: 2,
      parentFrameId: 0,
      requestId: url,
      method: 'GET',
      timeStamp: Date.now(),
      thirdParty: true,
      originUrl,
      documentUrl: originUrl,
      incognito: false,
      cookieStoreId: 'firefox-default',
    } as browser.webRequest._OnBeforeRequestDetails;
  }

  beforeEach(() => {
    mock = new MockBrowser();
  });

  afterEach(() => {
    MockBrowser.uninstall();
  });

  it('creates a 30-minute window and reports it in runtime state', async () => {
    const app = await loadApp(mock);
    mock.addTab({ url: 'https://mail.google.com/', active: true });
    const before = Date.now();
    await app.handleMessage({
      type: 'temporarily-allow',
      host: 'https://mail.google.com/',
      minutes: 30,
    });
    const state = (await app.handleMessage({ type: 'get-state' })) as RuntimeState;
    expect(state.tempAllowedUntil).not.toBeNull();
    expect(state.tempAllowedUntil! - before).toBeGreaterThanOrEqual(29.9 * 60_000);
    expect(state.tempAllowedUntil! - before).toBeLessThanOrEqual(31 * 60_000);
  }, 15000);

  it('removes the window again', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'temporarily-allow', host: 'mail.google.com', minutes: 30 });
    await app.handleMessage({ type: 'remove-temporary-allow', host: 'mail.google.com' });
    const state = (await app.handleMessage({ type: 'get-state' })) as RuntimeState;
    expect(state.tempAllowedUntil).toBeNull();
  }, 15000);

  it('rejects invalid hosts', async () => {
    const app = await loadApp(mock);
    await expect(
      app.handleMessage({ type: 'temporarily-allow', host: 'not a hostname!', minutes: 30 })
    ).rejects.toThrow(/Invalid site/);
  }, 15000);

  it('shows remaining minutes on the tab badge while a window is live', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'temporarily-allow', host: 'example.com', minutes: 12 });
    // Simulate the tab cache learning the tab's URL (as tabs.onUpdated does).
    mock.tabsOnUpdated.emit(
      1,
      {},
      { id: 1, url: 'https://example.com/page', cookieStoreId: 'firefox-default' }
    );
    const response = app.onBeforeSubresource(
      scriptDetails('https://www.google-analytics.com/analytics.js', 'https://example.com/page')
    );
    expect(response).toEqual({ cancel: true });
    expect(mock.badgeByTab.get(1)).toMatch(/^\d+m$/);
  }, 15000);

  it('falls back to the blocked count once the allowance is gone', async () => {
    const app = await loadApp(mock);
    await app.handleMessage({ type: 'temporarily-allow', host: 'example.com', minutes: 12 });
    await app.handleMessage({ type: 'remove-temporary-allow', host: 'example.com' });
    mock.tabsOnUpdated.emit(
      1,
      {},
      { id: 1, url: 'https://example.com/x', cookieStoreId: 'firefox-default' }
    );
    app.onBeforeSubresource(
      scriptDetails('https://www.google-analytics.com/a.js', 'https://example.com/x')
    );
    expect(mock.badgeByTab.get(1)).toBe('1');
  }, 15000);
});
