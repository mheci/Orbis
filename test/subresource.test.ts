/**
 * Third-party resource blocking tests.
 *
 * Two failure modes matter here and they pull in opposite directions:
 *
 *   Blocking too little leaves Google receiving your IP address and the page
 *   you are reading, on sites that have nothing to do with Google.
 *
 *   Blocking too much breaks the web. Fonts, hosted script libraries,
 *   reCAPTCHA and embedded players are load-bearing, and a privacy tool that
 *   locks people out of their accounts has failed at being useful.
 *
 * The second set of tests is therefore as important as the first.
 */

import { describe, expect, it } from 'vitest';
import { SubresourceClassifier, type BlockingMode } from '../src/core/subresource.js';
import { UrlMatcher } from '../src/core/matcher.js';
import { makeSettings } from './helpers.js';

const matcher = new UrlMatcher(makeSettings());

function classifier(mode: BlockingMode = 'standard', allowlist: string[] = []) {
  return new SubresourceClassifier(mode, allowlist, matcher);
}

/** A Google resource requested by an ordinary third-party website. */
function onThirdParty(url: string, type = 'script', origin = 'https://news.example.com/article') {
  return { url, originUrl: origin, type, tabInContainer: false };
}

describe('blocking Google tracking on other websites', () => {
  const blocked = [
    'https://www.google-analytics.com/analytics.js',
    'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX',
    'https://www.googletagmanager.com/gtag/js?id=G-XXXX',
    'https://www.googleadservices.com/pagead/conversion.js',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    'https://stats.g.doubleclick.net/dc.js',
    'https://www.google-analytics.com/collect?v=1&tid=UA-1',
    'https://app-measurement.com/a',
    'https://googleads.g.doubleclick.net/pagead/id',
    'https://www.googleoptimize.com/optimize.js',
  ];

  it.each(blocked)('blocks %s', (url) => {
    const decision = classifier().decide(onThirdParty(url));
    expect(decision.action).toBe('block');
    expect(decision.resourceClass).toBe('tracking');
  });

  it('blocks a tracking pixel loaded as an image', () => {
    const decision = classifier().decide(
      onThirdParty('https://www.google-analytics.com/collect?v=1', 'image')
    );
    expect(decision.action).toBe('block');
  });

  it('blocks an advertising iframe', () => {
    const decision = classifier().decide(
      onThirdParty('https://tpc.googlesyndication.com/safeframe/1/html', 'sub_frame')
    );
    expect(decision.action).toBe('block');
  });

  it('blocks a beacon sent on page unload', () => {
    const decision = classifier().decide(
      onThirdParty('https://www.google-analytics.com/g/collect', 'ping')
    );
    expect(decision.action).toBe('block');
  });

  it('blocks social widgets', () => {
    expect(classifier().decide(onThirdParty('https://apis.google.com/js/plusone.js')).action).toBe(
      'block'
    );
  });
});

describe('not breaking the web', () => {
  // Each of these has a visible consequence if wrongly blocked, noted inline.
  const mustLoad: Array<[string, string]> = [
    ['https://fonts.googleapis.com/css2?family=Inter', 'page renders with fallback fonts'],
    ['https://fonts.gstatic.com/s/inter/v12/font.woff2', 'page renders with fallback fonts'],
    ['https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js', 'page scripts die'],
    ['https://maps.googleapis.com/maps/api/js?key=x', 'embedded map is blank'],
    ['https://maps.gstatic.com/mapfiles/tile.png', 'map tiles missing'],
    ['https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js', 'app fails to start'],
    ['https://www.google.com/recaptcha/api.js', 'cannot submit forms'],
    ['https://www.google.com/recaptcha/api2/anchor', 'cannot submit forms'],
    ['https://recaptcha.net/recaptcha/api.js', 'cannot submit forms'],
    ['https://accounts.google.com/gsi/client', 'cannot sign in'],
    ['https://apis.google.com/js/api.js', 'cannot sign in'],
    ['https://www.youtube.com/iframe_api', 'embedded video player dead'],
    ['https://www.youtube-nocookie.com/embed/abc', 'embedded video dead'],
    ['https://i.ytimg.com/vi/abc/hq.jpg', 'video thumbnail missing'],
    ['https://translate.googleapis.com/translate_a/element.js', 'translation widget dead'],
    ['https://storage.googleapis.com/bucket/app.js', 'application assets missing'],
    ['https://firestore.googleapis.com/v1/projects/x', 'application data missing'],
    ['https://identitytoolkit.googleapis.com/v1/accounts', 'cannot sign in'],
  ];

  it.each(mustLoad)('allows %s (otherwise: %s)', (url) => {
    expect(classifier().decide(onThirdParty(url)).action).toBe('allow');
  });

  it('never blocks stylesheets or fonts, whatever the classification', () => {
    for (const type of ['stylesheet', 'font']) {
      const decision = classifier('strict').decide(
        onThirdParty('https://www.google-analytics.com/x.css', type)
      );
      expect(decision.action).toBe('allow');
    }
  });

  it('never blocks a top-level page load, that is the navigation engine\u2019s job', () => {
    const decision = classifier('strict').decide(
      onThirdParty('https://www.google-analytics.com/x', 'main_frame')
    );
    expect(decision.action).toBe('allow');
  });

  it('keeps sign-in working even in strict mode', () => {
    for (const url of [
      'https://accounts.google.com/gsi/client',
      'https://apis.google.com/js/api.js',
      'https://www.google.com/recaptcha/api.js',
      'https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js',
    ]) {
      const decision = classifier('strict').decide(onThirdParty(url));
      expect(decision.action).toBe('allow');
      expect(decision.reason).toBe('never-block');
    }
  });
});

describe('first-party requests are left alone', () => {
  it('allows Google resources on Google pages', () => {
    const decision = classifier().decide({
      url: 'https://www.google-analytics.com/analytics.js',
      originUrl: 'https://mail.google.com/mail/u/0',
      type: 'script',
      tabInContainer: false,
    });
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('google-first-party');
  });

  it('allows everything when the tab is inside the container', () => {
    const decision = classifier().decide({
      url: 'https://www.google-analytics.com/analytics.js',
      originUrl: 'https://news.example.com/',
      type: 'script',
      tabInContainer: true,
    });
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('tab-in-container');
  });

  it('allows resources a site loads from itself', () => {
    const decision = classifier().decide({
      url: 'https://cdn.example.com/app.js',
      originUrl: 'https://www.example.com/',
      type: 'script',
      tabInContainer: false,
    });
    expect(decision.action).toBe('allow');
  });

  it('ignores resources that are not Google at all', () => {
    const decision = classifier().decide(onThirdParty('https://cdn.jsdelivr.net/npm/x.js'));
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('not-google');
  });
});

describe('modes', () => {
  it('off allows everything', () => {
    expect(
      classifier('off').decide(onThirdParty('https://www.google-analytics.com/analytics.js')).action
    ).toBe('allow');
  });

  it('standard blocks tracking but keeps functional resources', () => {
    const c = classifier('standard');
    expect(c.decide(onThirdParty('https://www.google-analytics.com/analytics.js')).action).toBe(
      'block'
    );
    expect(c.decide(onThirdParty('https://fonts.googleapis.com/css2?family=X')).action).toBe(
      'allow'
    );
  });

  it('strict also blocks functional resources', () => {
    const c = classifier('strict');
    expect(c.decide(onThirdParty('https://fonts.googleapis.com/css2?family=X')).action).toBe(
      'block'
    );
    expect(
      c.decide(onThirdParty('https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/j.js')).action
    ).toBe('block');
  });

  it('strict blocks unclassified Google hosts, standard does not', () => {
    const url = 'https://some-new-service.googleapis.com/v1/data';
    expect(classifier('standard').decide(onThirdParty(url)).action).toBe('allow');
    expect(classifier('strict').decide(onThirdParty(url)).action).toBe('block');
  });
});

describe('user allowlist', () => {
  it('exempts a whole site', () => {
    const c = classifier('standard', ['shop.example.com']);
    const decision = c.decide(
      onThirdParty(
        'https://www.google-analytics.com/analytics.js',
        'script',
        'https://shop.example.com/checkout'
      )
    );
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('user-allowlist');
  });

  it('covers subdomains of an allowlisted site', () => {
    const c = classifier('standard', ['example.com']);
    expect(
      c.decide(
        onThirdParty('https://www.google-analytics.com/a.js', 'script', 'https://a.b.example.com/')
      ).action
    ).toBe('allow');
  });

  it('does not exempt other sites', () => {
    const c = classifier('standard', ['shop.example.com']);
    expect(
      c.decide(
        onThirdParty('https://www.google-analytics.com/a.js', 'script', 'https://other.com/')
      ).action
    ).toBe('block');
  });
});

describe('robustness', () => {
  it('allows a request with no reported origin rather than guessing', () => {
    const decision = classifier().decide({
      url: 'https://www.google-analytics.com/analytics.js',
      originUrl: null,
      type: 'script',
      tabInContainer: false,
    });
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('no-origin');
  });

  it.each(['', 'not a url', '://', 'javascript:alert(1)', 'data:text/html,x'])(
    'handles malformed url %s without throwing',
    (url) => {
      expect(() => classifier().decide(onThirdParty(url))).not.toThrow();
      expect(classifier().decide(onThirdParty(url)).action).toBe('allow');
    }
  );

  it('handles a malformed origin', () => {
    const decision = classifier().decide({
      url: 'https://www.google-analytics.com/a.js',
      originUrl: 'not a url',
      type: 'script',
      tabInContainer: false,
    });
    expect(decision.action).toBe('allow');
  });

  it('is not fooled by a lookalike host', () => {
    const decision = classifier().decide(
      onThirdParty('https://www.google-analytics.com.evil.net/a.js')
    );
    // Not a Google address at all, so out of scope rather than blocked.
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('not-google');
  });

  it('caches repeated decisions', () => {
    const c = classifier();
    const ctx = onThirdParty('https://www.google-analytics.com/analytics.js');
    const first = c.decideCached(ctx);
    const second = c.decideCached(ctx);
    expect(second).toBe(first);
  });

  it('keeps the cache bounded', () => {
    const c = classifier();
    for (let i = 0; i < 4000; i++) {
      c.decideCached(onThirdParty(`https://www.google-analytics.com/a.js?i=${i}`));
    }
    const cache = (c as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBeLessThanOrEqual(1024);
  });

  it('classifies quickly enough for the request path', () => {
    const c = classifier();
    const urls = [
      'https://www.google-analytics.com/analytics.js',
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://cdn.example.com/app.js',
      'https://www.googletagmanager.com/gtm.js',
    ];
    const started = performance.now();
    for (let i = 0; i < 20_000; i++) {
      c.decide(onThirdParty(`${urls[i % urls.length]}#${i}`));
    }
    // 20k uncached classifications. This runs on every sub-resource of every
    // page, so a regression here would slow down all browsing.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
