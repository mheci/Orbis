/**
 * Domain matching tests.
 *
 * These are the most important tests in the project: a false positive pulls an
 * unrelated site into the container, and a false negative leaks Google cookies.
 */

import { describe, expect, it } from 'vitest';
import { makeMatcher } from './helpers.js';
import { UrlMatcher } from '../src/core/matcher.js';
import { makeSettings } from './helpers.js';

const matcher = makeMatcher();

describe('core Google properties', () => {
  const googleUrls = [
    'https://www.google.com/',
    'https://google.com/search?q=firefox',
    'https://mail.google.com/mail/u/0/',
    'https://drive.google.com/drive/my-drive',
    'https://docs.google.com/document/d/abc/edit',
    'https://calendar.google.com/calendar/u/0/r',
    'https://meet.google.com/abc-defg-hij',
    'https://chat.google.com/',
    'https://contacts.google.com/',
    'https://keep.google.com/',
    'https://maps.google.com/maps',
    'https://earth.google.com/web/',
    'https://news.google.com/topstories',
    'https://shopping.google.com/',
    'https://books.google.com/',
    'https://translate.google.com/',
    'https://play.google.com/store',
    'https://pay.google.com/',
    'https://wallet.google.com/',
    'https://myaccount.google.com/',
    'https://accounts.google.com/',
    'https://ads.google.com/',
    'https://analytics.google.com/analytics/web/',
    'https://cloud.google.com/',
    'https://console.cloud.google.com/',
    'https://firebase.google.com/',
    'https://developers.google.com/',
    'https://search.google.com/search-console',
    'https://bard.google.com/',
    'https://gemini.google.com/app',
    'https://labs.google/',
    'https://ai.google/',
    'https://store.google.com/',
    'https://support.google.com/',
    'https://takeout.google.com/',
    'https://families.google.com/',
    'https://classroom.google.com/',
    'https://workspace.google.com/',
    'https://groups.google.com/',
    'https://sites.google.com/',
    'https://script.google.com/',
    'https://voice.google.com/',
    'https://fi.google.com/',
    'https://domains.google/',
    'https://travel.google/',
    'https://artsandculture.google.com/',
    'https://health.google/',
    'https://safety.google/',
    'https://opensource.google/',
    'https://about.google/',
    'https://blog.google/',
    'https://notifications.google.com/',
    'https://passwords.google.com/',
    'https://passwordmanager.google.com/',
    'https://one.google.com/',
    'https://lens.google.com/',
    'https://photos.google.com/',
    'https://grow.google/',
    'https://gmail.com/',
    'https://www.googlemail.com/',
    'https://www.gstatic.com/foo.png',
    'https://lh3.googleusercontent.com/x',
    'https://yt3.ggpht.com/x',
    'https://about.withgoogle.com/',
    'https://chromium.googlesource.com/',
    'https://www.blogger.com/',
    'https://someblog.blogspot.com/2020/01/post.html',
    'https://redirector.googlevideo.com/videoplayback',
    'https://proxy.googlezip.net/',
    'https://goo.gl/maps/abc',
    'https://g.co/kgs/abc',
    'https://www.chrome.com/',
    'https://www.chromecast.com/',
    'https://angular.io/',
    'https://dart.dev/',
    'https://flutter.dev/',
    'https://go.dev/',
    'https://fuchsia.dev/',
  ];

  it.each(googleUrls)('containerizes %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(true);
  });
});

describe('Google acquisitions on their own brand domains', () => {
  // These stay on non-google.com domains after acquisition, so they are easy to
  // forget. Each was verified as Google-owned before being added.
  const acquisitions = [
    'https://www.fitbit.com/',
    'https://nest.com/',
    'https://tenor.com/view/abc',
    'https://www.waze.com/live-map',
    'https://looker.com/',
    'https://www.mandiant.com/',
    'https://www.kaggle.com/datasets',
    'https://dialogflow.com/',
    'https://firebase.crashlytics.com/',
    'https://socratic.org/',
    'https://photomath.com/',
    'https://www.widevine.com/',
    'https://apigee.com/',
  ];
  it.each(acquisitions)('containerizes %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(true);
  });
});

describe('YouTube properties', () => {
  const urls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/',
    'https://music.youtube.com/',
    'https://studio.youtube.com/',
    'https://tv.youtube.com/',
    'https://www.youtube-nocookie.com/embed/abc',
    'https://www.youtubeeducation.com/',
    'https://i.ytimg.com/vi/abc/hq.jpg',
    'https://r1---sn-abc.googlevideo.com/videoplayback',
    'https://www.youtube.de/',
    'https://www.youtube.co.uk/',
  ];
  it.each(urls)('containerizes %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(true);
  });
});

describe('country-code Google domains', () => {
  const ccTLDs = [
    'https://www.google.co.uk/',
    'https://www.google.de/',
    'https://www.google.fr/',
    'https://www.google.co.jp/',
    'https://www.google.com.br/',
    'https://www.google.com.eg/',
    'https://www.google.com.au/',
    'https://www.google.co.in/',
    'https://www.google.ru/',
    'https://www.google.ca/',
    'https://www.google.com.hk/',
    'https://www.google.co.za/',
    'https://www.google.com.tr/',
    'https://www.google.pl/',
    'https://www.google.nl/',
    'https://www.google.cat/',
  ];
  it.each(ccTLDs)('containerizes %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(true);
  });

  it('covers a large number of countries', () => {
    expect(matcher.ruleCounts().hosts).toBeGreaterThan(500);
  });
});

describe('brand gTLD future-proofing', () => {
  it.each([
    'https://something-brand-new.google/',
    'https://future.youtube/',
    'https://x.chrome/',
    'https://foo.android/',
  ])('containerizes unknown host %s via brand TLD', (url) => {
    const result = matcher.match(url);
    expect(result.isGoogle).toBe(true);
    expect(result.source).toBe('brand-tld');
  });
});

describe('non-Google sites are never containerized', () => {
  const outside = [
    'https://example.com/',
    'https://duckduckgo.com/?q=google.com',
    'https://mozilla.org/',
    'https://en.wikipedia.org/wiki/Google',
    // Look-alikes and homograph-style attacks:
    'https://google.com.evil.com/',
    'https://notgoogle.com/',
    'https://mygoogle.com/',
    'https://google.com.co.uk.attacker.net/',
    'https://fakeyoutube.com/',
    'https://youtube.com.phishing.net/',
    'https://evil.com/?redirect=https://mail.google.com',
    'https://evil.com/#google.com',
    'https://googlefan.blog/',
    // Similar but unrelated real domains:
    'https://googol.com/',
    'https://gstaticx.com/',
  ];
  it.each(outside)('leaves %s alone', (url) => {
    expect(matcher.match(url).isGoogle).toBe(false);
  });
});

describe('scheme handling', () => {
  it.each([
    'about:blank',
    'moz-extension://abc/options.html',
    'file:///home/user/index.html',
    'view-source:https://google.com/',
    'data:text/html,<h1>google.com</h1>',
    'javascript:void(0)',
    'ftp://google.com/',
  ])('ignores non-http(s) URL %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(false);
  });

  it('handles malformed input without throwing', () => {
    for (const value of ['', 'not a url', '://', 'https://', '%%%']) {
      expect(() => matcher.match(value)).not.toThrow();
      expect(matcher.match(value).isGoogle).toBe(false);
    }
  });
});

describe('rule precedence', () => {
  it('never-list beats the domain database', () => {
    const m = new UrlMatcher(makeSettings({ neverContainerize: ['docs.google.com'] }));
    const result = m.match('https://docs.google.com/document/d/1');
    expect(result.isGoogle).toBe(false);
    expect(result.source).toBe('never-list');
  });

  it('never-list beats the always-list', () => {
    const m = new UrlMatcher(
      makeSettings({ alwaysContainerize: ['example.com'], neverContainerize: ['example.com'] })
    );
    expect(m.match('https://example.com/').isGoogle).toBe(false);
  });

  it('always-list containerizes an arbitrary host', () => {
    const m = new UrlMatcher(makeSettings({ alwaysContainerize: ['intranet.example.org'] }));
    const result = m.match('https://intranet.example.org/page');
    expect(result.isGoogle).toBe(true);
    expect(result.source).toBe('always-list');
  });

  it('applies never-rules to subdomains too', () => {
    const m = new UrlMatcher(makeSettings({ neverContainerize: ['google.com'] }));
    expect(m.match('https://mail.google.com/').isGoogle).toBe(false);
  });

  it('supports path-scoped rules', () => {
    const m = new UrlMatcher(makeSettings({ neverContainerize: ['docs.google.com/forms'] }));
    expect(m.match('https://docs.google.com/forms/d/e/1/viewform').isGoogle).toBe(false);
    expect(m.match('https://docs.google.com/document/d/1/edit').isGoogle).toBe(true);
  });

  it('honours disabled exceptions', () => {
    const enabled = new UrlMatcher(
      makeSettings({
        exceptions: [{ pattern: 'photos.google.com', enabled: true, created: 0 }],
      })
    );
    const disabled = new UrlMatcher(
      makeSettings({
        exceptions: [{ pattern: 'photos.google.com', enabled: false, created: 0 }],
      })
    );
    expect(enabled.match('https://photos.google.com/').isGoogle).toBe(false);
    expect(disabled.match('https://photos.google.com/').isGoogle).toBe(true);
  });
});

describe('optional domain sets', () => {
  it('leaves ad/measurement domains alone by default', () => {
    expect(matcher.match('https://www.googletagmanager.com/gtm.js').isGoogle).toBe(false);
    expect(matcher.match('https://doubleclick.net/').isGoogle).toBe(false);
  });

  it('containerizes them when the set is enabled', () => {
    const m = new UrlMatcher(makeSettings({ domainSets: { trackers: true } }));
    expect(m.match('https://www.googletagmanager.com/gtm.js').isGoogle).toBe(true);
  });

  it('leaves user-content hosting alone by default', () => {
    expect(matcher.match('https://random-app.web.app/').isGoogle).toBe(false);
    expect(matcher.match('https://someproject.appspot.com/').isGoogle).toBe(false);
  });

  it('can disable the YouTube set independently', () => {
    const m = new UrlMatcher(makeSettings({ domainSets: { youtube: false } }));
    expect(m.match('https://www.youtube.com/').isGoogle).toBe(false);
    expect(m.match('https://www.google.com/').isGoogle).toBe(true);
  });
});

describe('built-in never list (federated sign-in widgets)', () => {
  it('keeps the GSI widget out of the container', () => {
    const result = matcher.match('https://accounts.google.com/gsi/client');
    expect(result.isGoogle).toBe(false);
    expect(result.source).toBe('builtin-never');
  });

  it('still containerizes normal accounts.google.com pages', () => {
    expect(matcher.match('https://accounts.google.com/').isGoogle).toBe(true);
  });
});

describe('OAuth endpoint detection', () => {
  it.each([
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://accounts.google.com/signin/oauth/consent',
    'https://accounts.google.com/ServiceLogin?continue=x',
  ])('detects %s', (url) => {
    expect(matcher.isOAuthEndpoint(url)).toBe(true);
  });

  it.each(['https://mail.google.com/', 'https://example.com/o/oauth2/auth'])(
    'does not treat %s as an OAuth endpoint',
    (url) => {
      expect(matcher.isOAuthEndpoint(url)).toBe(false);
    }
  );
});

describe('redirector unwrapping', () => {
  it('unwraps google.com/url?q= to an external site', () => {
    expect(matcher.unwrapRedirector('https://www.google.com/url?q=https://example.com/page')).toBe(
      'https://example.com/page'
    );
  });

  it('unwraps youtube.com/redirect?q=', () => {
    expect(
      matcher.unwrapRedirector('https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.org%2F')
    ).toBe('https://example.org/');
  });

  it('does not unwrap when the destination is also Google', () => {
    expect(
      matcher.unwrapRedirector('https://www.google.com/url?q=https://mail.google.com/')
    ).toBeNull();
  });

  it('ignores non-redirector URLs', () => {
    expect(matcher.unwrapRedirector('https://www.google.com/search?q=test')).toBeNull();
    expect(matcher.unwrapRedirector('https://example.com/url?q=https://evil.com')).toBeNull();
  });

  it('rejects non-http destinations', () => {
    expect(matcher.unwrapRedirector('https://www.google.com/url?q=javascript:alert(1)')).toBeNull();
    expect(matcher.unwrapRedirector('https://www.google.com/url?q=not-a-url')).toBeNull();
  });
});

describe('case, port, userinfo and trailing-dot normalisation', () => {
  it.each([
    'https://MAIL.GOOGLE.COM/',
    'https://mail.google.com.:443/',
    'https://www.google.com:443/search',
  ])('normalises %s', (url) => {
    expect(matcher.match(url).isGoogle).toBe(true);
  });

  it('is not fooled by userinfo containing a Google host', () => {
    expect(matcher.match('https://www.google.com@evil.com/').isGoogle).toBe(false);
  });
});
