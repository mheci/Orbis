<div align="center">

# G-Container

**Automatically isolate every Google-owned site in a dedicated Firefox Container.**

[![CI](https://github.com/astarling-x/g-container/actions/workflows/ci.yml/badge.svg)](https://github.com/astarling-x/g-container/actions/workflows/ci.yml)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![Firefox 140+](https://img.shields.io/badge/firefox-140%2B-orange.svg)](https://www.mozilla.org/firefox/new/)

</div>

G-Container is the Google equivalent of Mozilla's _Facebook Container_, built to be more
comprehensive, more configurable and easier to maintain. It puts Google, YouTube, Gmail, Drive,
Maps and **700+ other Google-owned hosts** into one dedicated Firefox Container so that Google's
cookies live in their own jar and cannot be used to follow you around the rest of the web.

---

## Why this exists

Google sees a very large share of your browsing through search, YouTube, Analytics, reCAPTCHA and
embedded sign-in widgets. Firefox Containers give each container its own cookie jar, local storage
and cache partition. G-Container automates the tedious part: you never have to remember to open
Google links in the right container, because every Google navigation is moved there automatically —
and every non-Google navigation is moved back out.

**What you get**

- Google cookies cannot leak into normal browsing.
- Normal-browsing cookies cannot leak into your Google session.
- You stay logged into Google without that login identifying you elsewhere.
- Third-party "Sign in with Google" still works (see [OAuth handling](#oauth-and-sign-in-with-google)).

**What this is not.** G-Container is a _compartmentalisation_ tool, not a blocker. It does not stop
Google from seeing the requests you deliberately send them, and it does not hide your IP address.
Pair it with Firefox's Enhanced Tracking Protection or uBlock Origin for content blocking.

---

## Features

|                              |                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 🔒 **Automatic isolation**   | Any Google host opened anywhere is re-opened in the Google container.                                                    |
| 🌍 **700+ domains**          | Every ccTLD (`google.co.uk`, `google.com.eg`, …), the `.google` brand gTLD, YouTube, Blogger, Gmail, Workspace and more. |
| 🔮 **Future-proof**          | Any new `*.google` / `*.youtube` host is matched automatically — no update needed.                                       |
| 🔁 **Two-way containment**   | Non-Google pages opened inside the container are pushed back out.                                                        |
| 🔗 **Redirector unwrapping** | `google.com/url?q=…` links land on the real destination, outside the container.                                          |
| 🔑 **OAuth aware**           | Third-party "Sign in with Google" completes in the calling site's context.                                               |
| ⚙️ **Fully configurable**    | Rename/recolour the container, toggle domain sets, always/never lists, exceptions.                                       |
| 💾 **Backup & restore**      | Versioned, human-readable JSON. Every import is validated and sanitised.                                                 |
| 🧪 **Tested**                | 256 automated tests covering matching, decisions, storage, containers and performance.                                   |
| 🛡️ **Private by design**     | No telemetry, no analytics, no network requests, no remote code, no dependencies at runtime.                             |

---

## Install

**From source** (until the AMO listing is live):

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm install
npm run build
```

Then open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
`dist/manifest.json`. Full instructions, including permanent installation and signing, are in
**[INSTALL.md](INSTALL.md)**.

---

## How it works

```
navigation ──► webRequest.onBeforeRequest (main_frame, blocking)
                        │
                        ▼
              gather facts (tab, opener, cookie store)
                        │
                        ▼
              decideNavigation()  ← pure function, no I/O
                        │
        ┌───────────────┼────────────────┬──────────────┐
        ▼               ▼                ▼              ▼
     contain         release          unwrap         ignore
   (Google URL     (non-Google      (redirector    (loop guard,
    outside)        inside)          link out)      OAuth, paused…)
```

The decision engine is a **pure function**: it takes an immutable description of a navigation and
returns an action. That makes behaviour deterministic and exhaustively testable, and it keeps the
browser-facing code a thin adapter. See **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Matching precedence

1. User **Never containerize** list — always wins.
2. User **exceptions** (enabled ones).
3. Built-in never list — embedded Google sign-in widgets used by other sites.
4. User **Always containerize** list.
5. Brand gTLDs — anything ending in `.google`, `.youtube`, `.chrome`, …
6. Enabled domain sets from the domain database.
7. Otherwise: normal browsing.

Matching is performed on the **parsed URL's hostname** using a reverse-label trie, never on the raw
string. `https://google.com.evil.com/` and `https://evil.com/?u=google.com` are correctly treated
as _not_ Google — both are covered by tests.

---

## Configuration

Open the popup → ⚙, or `about:addons` → G-Container → Preferences.

- **General** — enable/pause protection, rename the container, change its colour and icon, toggle
  behaviours (redirector unwrapping, OAuth pass-through, releasing non-Google pages, private
  windows, statistics, Firefox Sync).
- **Domains** — switch domain sets on or off:
  - _Google core properties_ (on) and _YouTube & video delivery_ (on)
  - _Advertising & measurement_ (off by default — top-level visits to `doubleclick.net` and friends
    are almost always ad click-throughs that belong to the originating site)
  - _User-content hosting_ (off by default — `appspot.com`, `web.app` etc. host unrelated apps)
- **Rules & exceptions** — always/never lists, with `host` or `host/path-prefix` granularity.
- **Backup & data** — export/import JSON, view local statistics, reset.
- **Diagnostics** — runtime state and a **URL tester** that tells you exactly which rule matched.

### OAuth and "Sign in with Google"

When a third-party site sends you to `accounts.google.com/o/oauth2/…`, containerizing that
navigation would deliver the callback into the wrong cookie jar and break the login. With
**OAuth pass-through** enabled (the default), a sign-in flow started by a non-Google tab is left in
the calling site's context; the Google session cookies involved are the ones for that flow only.
Turn it off in Options if you prefer maximum strictness over convenience.

---

## Adding domains

The domain list is plain JSON — no code changes required:

```
src/domains/
├── google.json     core Google properties + .google gTLD hosts
├── youtube.json    YouTube, video CDNs
├── ccTLD.json      country suffixes × base labels (google, youtube, blogspot…)
├── aliases.json    redirectors, built-in never list, OAuth paths
├── trackers.json   ad/measurement domains (opt-in)
├── hosting.json    user-content hosting (opt-in)
└── schema.json     JSON Schema for all of the above
```

Add your host, run `npm test`, open a PR. Full guide: **[DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md)**.

---

## Development

```bash
npm install
npm run watch      # rebuild on change
npm test           # 292 unit/integration tests
npm run lint       # eslint + prettier
npm run typecheck  # tsc --noEmit, strict
npm run ci         # everything CI runs
npm run package    # dist/ → web-ext-artifacts/g_container-x.y.z.zip
```

TypeScript in strict mode, ESLint + Prettier, Vitest, esbuild. Zero runtime dependencies.

---

## Permissions

| Permission                         | Why                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextualIdentities`             | Create and manage the Google container.                                                                                                           |
| `cookies`                          | Required by Firefox to address container cookie stores.                                                                                           |
| `storage`                          | Persist your settings locally (and via Sync if you opt in).                                                                                       |
| `tabs`                             | Read a tab's URL/cookie store and re-open it in the right container.                                                                              |
| `menus`                            | The right-click "Open in Google Container" entries.                                                                                               |
| `webRequest`, `webRequestBlocking` | Intercept top-level navigations before they load.                                                                                                 |
| `<all_urls>`                       | A Google link can be followed from _any_ site, so navigations must be observed everywhere. Only the URL is inspected; page content is never read. |

Detailed justification: **[PERMISSIONS.md](docs/PERMISSIONS.md)**. CI fails the build if an
undocumented permission is added.

---

## Documentation

| Document                                           | Contents                                     |
| -------------------------------------------------- | -------------------------------------------- |
| [INSTALL.md](INSTALL.md)                           | Installation, building, signing              |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Module design, data flow, invariants         |
| [docs/DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md) | How to add or change domains                 |
| [docs/TESTING.md](docs/TESTING.md)                 | Test strategy and manual QA checklist        |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md)         | Per-permission justification                 |
| [docs/ROADMAP.md](docs/ROADMAP.md)                 | Planned work                                 |
| [CONTRIBUTING.md](CONTRIBUTING.md)                 | Workflow, Conventional Commits, PR checklist |
| [SECURITY.md](SECURITY.md)                         | Threat model, reporting vulnerabilities      |
| [CHANGELOG.md](CHANGELOG.md)                       | Release history                              |

---

## Privacy

G-Container makes **no network requests of its own**, contains **no telemetry, analytics or remote
code**, and ships **zero runtime dependencies**. Statistics are simple counters kept in
`storage.local` and can be disabled. See [SECURITY.md](SECURITY.md).

## License

[MPL-2.0](LICENSE) — the same licence Mozilla uses for Facebook Container.

## Acknowledgements

Inspired by [Mozilla's Facebook Container](https://github.com/mozilla/contain-facebook) and the
[Multi-Account Containers](https://github.com/mozilla/multi-account-containers) team.
