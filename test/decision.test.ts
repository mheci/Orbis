/**
 * Navigation decision tests — the behavioural contract of the extension.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COOKIE_STORE,
  LoopGuard,
  decideNavigation,
  isProtectionActive,
  type NavigationContext,
} from '../src/core/decision.js';
import { makeMatcher, makeSettings } from './helpers.js';
import type { DeepPartial, Settings } from '../src/types/index.js';

const CONTAINER = 'firefox-container-7';

function context(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    url: 'https://www.google.com/',
    tabId: 1,
    cookieStoreId: DEFAULT_COOKIE_STORE,
    containerId: CONTAINER,
    openerTabId: null,
    openerCookieStoreId: null,
    incognito: false,
    now: 1_000_000,
    ...overrides,
  };
}

function deps(settingsOverrides: DeepPartial<Settings> = {}, guard = new LoopGuard()) {
  const settings = makeSettings(settingsOverrides);
  return { settings, matcher: makeMatcher(settingsOverrides), loopGuard: guard };
}

describe('containing Google navigations', () => {
  it('moves a Google URL from the default store into the container', () => {
    const action = decideNavigation(context(), deps());
    expect(action.kind).toBe('contain');
    if (action.kind === 'contain') {
      expect(action.cookieStoreId).toBe(CONTAINER);
      expect(action.url).toBe('https://www.google.com/');
      expect(action.replaceTabId).toBe(1);
    }
  });

  it('leaves an already-contained Google URL alone', () => {
    const action = decideNavigation(context({ cookieStoreId: CONTAINER }), deps());
    expect(action.kind).toBe('ignore');
    if (action.kind === 'ignore') expect(action.reason).toBe('already-contained');
  });

  it('ignores non-Google URLs outside the container', () => {
    const action = decideNavigation(context({ url: 'https://example.com/' }), deps());
    expect(action.kind).toBe('ignore');
    if (action.kind === 'ignore') expect(action.reason).toBe('not-google');
  });

  it.each([
    'https://youtu.be/abc',
    'https://mail.google.com/mail/u/0',
    'https://www.google.co.uk/',
    'https://music.youtube.com/',
  ])('contains %s', (url) => {
    expect(decideNavigation(context({ url }), deps()).kind).toBe('contain');
  });
});

describe('releasing non-Google navigations from the container', () => {
  it('pushes a non-Google page back out', () => {
    const action = decideNavigation(
      context({ url: 'https://example.com/', cookieStoreId: CONTAINER }),
      deps()
    );
    expect(action.kind).toBe('release');
    if (action.kind === 'release') expect(action.replaceTabId).toBe(1);
  });

  it('keeps it inside when the option is disabled', () => {
    const action = decideNavigation(
      context({ url: 'https://example.com/', cookieStoreId: CONTAINER }),
      deps({ behaviour: { releaseNonGoogle: false } })
    );
    expect(action.kind).toBe('ignore');
  });
});

describe('redirector unwrapping', () => {
  it('unwraps a search result link to an external site', () => {
    const action = decideNavigation(
      context({
        url: 'https://www.google.com/url?q=https://example.com/article',
        cookieStoreId: CONTAINER,
      }),
      deps()
    );
    expect(action.kind).toBe('unwrap');
    if (action.kind === 'unwrap') {
      expect(action.url).toBe('https://example.com/article');
      expect(action.targetOutside).toBe(true);
    }
  });

  it('does not unwrap when the feature is disabled', () => {
    const action = decideNavigation(
      context({
        url: 'https://www.google.com/url?q=https://example.com/article',
        cookieStoreId: CONTAINER,
      }),
      deps({ behaviour: { unwrapRedirectors: false } })
    );
    expect(action.kind).toBe('ignore');
  });
});

describe('OAuth pass-through', () => {
  it('keeps a third-party sign-in flow outside the container', () => {
    const action = decideNavigation(
      context({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y',
        openerTabId: 42,
        openerCookieStoreId: DEFAULT_COOKIE_STORE,
      }),
      deps()
    );
    expect(action.kind).toBe('ignore');
    if (action.kind === 'ignore') expect(action.reason).toBe('oauth-passthrough');
  });

  it('contains the OAuth page when the user navigated there directly', () => {
    const action = decideNavigation(
      context({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' }),
      deps()
    );
    expect(action.kind).toBe('contain');
  });

  it('contains the OAuth page when the opener is already in the container', () => {
    const action = decideNavigation(
      context({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
        openerTabId: 42,
        openerCookieStoreId: CONTAINER,
      }),
      deps()
    );
    expect(action.kind).toBe('contain');
  });

  it('contains it when pass-through is disabled', () => {
    const action = decideNavigation(
      context({
        url: 'https://accounts.google.com/o/oauth2/v2/auth',
        openerTabId: 42,
        openerCookieStoreId: DEFAULT_COOKIE_STORE,
      }),
      deps({ behaviour: { oauthPassthrough: false } })
    );
    expect(action.kind).toBe('contain');
  });
});

describe('guard rails', () => {
  it('does nothing when the extension is disabled', () => {
    expect(decideNavigation(context(), deps({ enabled: false })).kind).toBe('ignore');
  });

  it('does nothing while paused', () => {
    const settings = deps({ pausedUntil: 2_000_000 });
    expect(decideNavigation(context({ now: 1_000_000 }), settings).kind).toBe('ignore');
  });

  it('resumes automatically once the pause expires', () => {
    const settings = deps({ pausedUntil: 900_000 });
    expect(decideNavigation(context({ now: 1_000_000 }), settings).kind).toBe('contain');
  });

  it('ignores private windows unless opted in', () => {
    expect(decideNavigation(context({ incognito: true }), deps()).kind).toBe('ignore');
    expect(
      decideNavigation(
        context({ incognito: true }),
        deps({ behaviour: { handlePrivateWindows: true } })
      ).kind
    ).toBe('contain');
  });

  it('does nothing when the container could not be created', () => {
    const action = decideNavigation(context({ containerId: null }), deps());
    expect(action.kind).toBe('ignore');
    if (action.kind === 'ignore') expect(action.reason).toBe('container-unavailable');
  });

  it.each(['about:blank', 'moz-extension://x/y', 'file:///tmp/a.html'])('ignores %s', (url) => {
    const action = decideNavigation(context({ url }), deps());
    expect(action.kind).toBe('ignore');
    if (action.kind === 'ignore') expect(action.reason).toBe('unsupported-scheme');
  });

  it('isProtectionActive reflects enabled and pause state', () => {
    expect(isProtectionActive(makeSettings(), Date.now())).toBe(true);
    expect(isProtectionActive(makeSettings({ enabled: false }), Date.now())).toBe(false);
    expect(isProtectionActive(makeSettings({ pausedUntil: Date.now() + 1000 }), Date.now())).toBe(
      false
    );
  });
});

describe('loop protection', () => {
  let guard: LoopGuard;
  beforeEach(() => {
    guard = new LoopGuard(3000, 10);
  });

  it('refuses to act twice on the same tab+url within the window', () => {
    const d = deps({}, guard);
    const first = decideNavigation(context(), d);
    expect(first.kind).toBe('contain');
    guard.remember(1, 'https://www.google.com/', 1_000_000);
    const second = decideNavigation(context({ now: 1_000_500 }), d);
    expect(second.kind).toBe('ignore');
    if (second.kind === 'ignore') expect(second.reason).toBe('loop-guard');
  });

  it('acts again once the window has elapsed', () => {
    const d = deps({}, guard);
    guard.remember(1, 'https://www.google.com/', 1_000_000);
    expect(decideNavigation(context({ now: 1_010_000 }), d).kind).toBe('contain');
  });

  it('scopes the guard per tab', () => {
    const d = deps({}, guard);
    guard.remember(1, 'https://www.google.com/', 1_000_000);
    expect(decideNavigation(context({ tabId: 2 }), d).kind).toBe('contain');
  });

  it('forgets a closed tab', () => {
    guard.remember(1, 'https://www.google.com/', 1_000_000);
    guard.forgetTab(1);
    expect(guard.isRepeat(1, 'https://www.google.com/', 1_000_100)).toBe(false);
  });

  it('never grows without bound', () => {
    const g = new LoopGuard(3000, 10);
    for (let i = 0; i < 200; i++) g.remember(i, `https://example.com/${i}`, 1_000_000 + i);
    expect(g.size).toBeLessThanOrEqual(20);
  });

  it('prunes expired entries', () => {
    const g = new LoopGuard(1000, 100);
    g.remember(1, 'https://a.example/', 0);
    g.prune(5000);
    expect(g.size).toBe(0);
  });

  it('breaks a two-site ping-pong redirect chain', () => {
    const d = deps({}, guard);
    let now = 1_000_000;
    let contained = 0;
    for (let i = 0; i < 20; i++) {
      const action = decideNavigation(context({ now }), d);
      if (action.kind === 'contain') {
        contained++;
        guard.remember(1, 'https://www.google.com/', now);
      }
      now += 100;
    }
    // Only one containment inside the 3s window, not twenty.
    expect(contained).toBe(1);
  });
});

describe('user rules affect decisions', () => {
  it('respects a never-rule for a Google host', () => {
    const action = decideNavigation(
      context({ url: 'https://docs.google.com/' }),
      deps({ neverContainerize: ['docs.google.com'] })
    );
    expect(action.kind).toBe('ignore');
  });

  it('respects an always-rule for a non-Google host', () => {
    const action = decideNavigation(
      context({ url: 'https://intranet.example.com/' }),
      deps({ alwaysContainerize: ['intranet.example.com'] })
    );
    expect(action.kind).toBe('contain');
  });
});
