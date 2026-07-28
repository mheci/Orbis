# G-Container

Keep Google in its own box.

G-Container is a Firefox extension that automatically opens every Google site in a separate
container, so the cookies Google sets there cannot be read anywhere else in your browsing.

[![CI](https://github.com/astarling-x/g-container/actions/workflows/ci.yml/badge.svg)](https://github.com/astarling-x/g-container/actions/workflows/ci.yml)
[![Security](https://github.com/astarling-x/g-container/actions/workflows/security.yml/badge.svg)](https://github.com/astarling-x/g-container/actions/workflows/security.yml)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![Firefox 140+](https://img.shields.io/badge/firefox-140%2B-orange.svg)](https://www.mozilla.org/firefox/new/)

## The problem

You search on Google, watch a video on YouTube, check Gmail. Google sets cookies in your browser
during all of that, which is normal and expected.

The catch is that those same cookies travel with you. Google services are embedded in a very large
share of the web through analytics, fonts, embedded videos, reCAPTCHA boxes and sign-in buttons.
Every time you load a page carrying one of those, your browser can hand over the identity you built
up while signed into Google. Your activity across unrelated sites gets joined into one profile.

## What G-Container does

Two things, working together.

**First, it keeps Google in a separate compartment.**

Firefox has a built-in feature called containers. Each container is a sealed compartment with its
own cookie jar, storage and cache. A site opened in one container cannot see anything belonging to
another.

G-Container puts that on autopilot for Google. Open any Google site, from anywhere, and it reopens
in a container named Google. Everything else keeps browsing normally, outside that container.

The result:

- You stay signed into Google, and it still works exactly as before.
- Google's cookies stay locked inside the container.
- Other sites cannot see your Google session, and Google cannot see your other browsing.

You do not have to remember anything or change how you browse. Click a Google link and it lands in
the right place on its own.

**Second, it stops Google trackers on other websites.**

Separating cookies is only half the problem. When a news site loads Google Analytics, that request
still tells Google your IP address, your browser, and which page you are reading, whether or not a
cookie goes with it.

So G-Container blocks those requests before they leave your machine. Analytics, advertising and
social widgets are stopped on sites that are not Google. The popup shows how many were blocked on
the page you are looking at.

Things websites genuinely need keep working. Google Fonts, embedded maps and videos, reCAPTCHA
boxes and "Sign in with Google" buttons are all left alone, because blocking those would break the
page rather than protect you. If you want maximum separation and can accept some broken sites,
strict mode in the settings blocks those too. Sign-in and reCAPTCHA stay allowed even then, so you
cannot be locked out of an account.

## What it does not do

Being clear about the limits matters more than overselling.

G-Container separates your browsing and blocks Google's tracking code on other sites. It is not a
general ad blocker, and it only deals with Google. Trackers belonging to anyone else are untouched.

Google can still see whatever you deliberately send them. Your IP address is unchanged when you
visit Google directly, and your browser fingerprint is not hidden.

For broad ad and tracker blocking across all companies, run something like uBlock Origin alongside
it. The two do different jobs and work well together.

## Install

Download the signed file from the
[latest release](https://github.com/astarling-x/g-container/releases/latest), then in Firefox open
`about:addons`, click the gear icon, and choose "Install Add-on From File".

The release is signed by Mozilla, so it installs permanently on any version of Firefox including
the regular one. Requires Firefox 140 or newer on desktop. Android is not supported because it has
no container feature.

Full instructions, including building from source, are in [INSTALL.md](INSTALL.md).

## Using it

There is nothing to configure. A container named Google is created the first time you visit a
Google site, and the defaults are the recommended setup.

Click the toolbar icon to see whether the current page is protected, how many Google trackers were
blocked on it, move a tab in or out of the container by hand, or pause protection for half an hour.

If a website misbehaves, the popup has a button to allow Google resources on that site only.

For more control, open the settings page from the popup. You can:

- Rename the container or change its colour and icon
- Choose how much to block: off, standard or strict
- Turn whole groups of domains on or off
- List sites where Google resources should load normally
- Force a specific site to always or never use the container
- Save your settings to a file and load them back later
- Check exactly why a given address was or was not put in the container

That last one is worth knowing about. If something behaves unexpectedly, go to Settings, then
Diagnostics, and paste the address into the URL tester. It names the exact rule that matched, which
usually explains the behaviour in a second.

## What counts as Google

The extension recognises 952 Google-owned addresses, grouped so you can switch parts off:

**Google services** (on by default, 713 addresses)
Search, Gmail, Drive, Docs, Maps, Photos, Calendar, Meet, Play, Cloud, Gemini and the rest. Includes
every country version of Google such as google.co.uk and google.com.eg, plus brand domains like
Fitbit, Nest, Waze, Kaggle and Tenor that Google owns but which kept their own names.

**YouTube** (on by default, 213 addresses)
youtube.com, youtu.be, the country versions, the no-cookie embed domain and the video servers.

**Advertising and measurement** (off by default, 16 addresses)
DoubleClick, Google Analytics, Tag Manager and similar. Off because landing on these is nearly
always an ad click passing through on the way to somewhere else, and forcing those into the
container tends to break the destination site. Cookie separation still applies either way, since
the container has its own jar regardless.

**App hosting** (off by default, 10 addresses)
appspot.com, web.app, firebaseapp.com and similar. Google owns these, but they host applications
built by other people that have nothing to do with Google. Leaving them out avoids dragging
unrelated sites into the container.

New Google services are usually covered without an update, because any address ending in .google or
.youtube is recognised automatically.

Adding a missing site is a one line change to a data file. See
[DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md).

## Signing in to other sites with Google

Plenty of sites offer a "Sign in with Google" button. Handled carelessly, containers break those,
because the login would finish in the wrong compartment and the site never receives its answer.

G-Container watches for this and lets the sign-in complete in the context of the site that started
it. The button keeps working. If you would rather have stricter separation and can live with the
occasional broken login, you can turn this off in the settings.

## How it works

Firefox tells the extension about a page load just before the request leaves your machine. The
extension checks the address, and if it belongs to Google and the tab is not already in the
container, it stops that request and reopens the page in the container instead.

Stopping the request before it is sent is the important part. If the page were allowed to load
first and moved afterwards, cookies from the wrong compartment would already have been sent, which
is the exact leak the extension exists to prevent.

The same logic runs in reverse. A non-Google page opened inside the container gets moved back out,
so the container only ever holds Google activity. Links that pass through Google on the way
somewhere else, like search result redirects, are followed to the real destination and opened
outside.

Address checking uses the parsed hostname rather than pattern matching on text, so lookalike
addresses such as google.com.example.net are correctly treated as unrelated. There are tests
covering that specifically.

For a deeper explanation see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Privacy

The extension makes no network requests of its own. Not to Google, not to us, not to anyone. The
list of Google addresses is built into the file you install.

There is no telemetry, no analytics and no crash reporting. It ships no third party code at all.
The usage counters shown in the popup are a handful of numbers kept on your own machine, and you
can switch them off.

It reads the address of pages you load, which is unavoidable for deciding where a page belongs. It
does not read page content, and injects nothing into pages.

Each permission it asks for is explained in [PERMISSIONS.md](docs/PERMISSIONS.md).

## Verifying what you install

Builds are reproducible, so you can check the released file was built from the published source
rather than trusting it:

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm ci
npm run package
sha256sum web-ext-artifacts/g_container-1.0.1.zip
```

The result matches the checksum published with the release.

## Contributing

Bug reports are welcome, and reports of a Google site being missed are the most useful kind. Include
the address and the output of the URL tester in Settings, then Diagnostics.

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm install
npm test
npm run build
```

Written in TypeScript with no runtime dependencies. 292 automated tests cover address matching,
navigation decisions, storage, container handling and performance. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Documentation

| File                                               | What is in it                              |
| -------------------------------------------------- | ------------------------------------------ |
| [INSTALL.md](INSTALL.md)                           | Installing, building and signing           |
| [CONTRIBUTING.md](CONTRIBUTING.md)                 | How to contribute                          |
| [SECURITY.md](SECURITY.md)                         | Threat model and reporting a vulnerability |
| [CHANGELOG.md](CHANGELOG.md)                       | What changed in each release               |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | How the code fits together                 |
| [docs/DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md) | Adding or correcting addresses             |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md)         | Why each permission is needed              |
| [docs/TESTING.md](docs/TESTING.md)                 | Test strategy and manual checks            |
| [docs/ROADMAP.md](docs/ROADMAP.md)                 | What is planned                            |

## Reporting a security issue

Please do not open a public issue. Use
[private vulnerability reporting](https://github.com/astarling-x/g-container/security/advisories/new)
instead. Details in [SECURITY.md](SECURITY.md).

## Licence

[MPL-2.0](LICENSE), the same licence Mozilla uses for its own container extensions.

Built on the ideas behind [Facebook Container](https://github.com/mozilla/contain-facebook) and
[Multi-Account Containers](https://github.com/mozilla/multi-account-containers). Not affiliated
with Mozilla or Google.
