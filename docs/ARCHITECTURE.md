# Architecture

This document explains how G-Container is put together, why it is put together that way, and which
invariants must hold. Read it before changing anything in `src/core/`.

## Guiding principles

1. **The core is pure.** Every decision the extension makes is computed by side-effect-free
   functions in `src/core/`. The browser-facing layer only gathers facts and executes actions.
   Determinism is what makes the behaviour testable and prevents race conditions.
2. **Data over code.** Which hosts are Google-owned is _data_ (`src/domains/*.json`), not logic.
   Adding a domain must never require touching TypeScript.
3. **Fail open, never fail closed-and-broken.** If storage is corrupt, the container was deleted,
   or an API throws, the extension degrades to "do nothing" rather than trapping the user's tabs.
4. **Least privilege.** No permission is requested unless a specific feature needs it, and CI
   enforces that every permission is documented.

## Module map

```
src/
├── manifest.json          MV3 manifest (Firefox 140+)
├── types/index.ts         All cross-module types. No runtime code.
├── domains/*.json         The domain database (see DOMAIN_DATABASE.md)
├── core/
│   ├── domain-db.ts       Loads + expands JSON into an in-memory database
│   ├── matcher.ts         Reverse-label trie; decides "is this URL Google?"
│   ├── decision.ts        Pure navigation decision engine + LoopGuard
│   ├── settings.ts        Defaults, sanitisation, merging, migration, backups
│   ├── container.ts       contextualIdentities lifecycle
│   └── storage.ts         storage.local / storage.sync adapter
├── background/index.ts    Event-page adapter: events → core → browser actions
├── popup/                 Popup UI (renders RuntimeState, sends messages)
└── options/               Options UI (renders Settings, sends patches)
```

Dependency direction is strictly one-way:

```
background ─► core ─► domains (data)
   ▲                    ▲
popup/options ──────────┘ (types only)
```

`core/` never imports from `background/`, `popup/` or `options/`, and never touches the `browser`
global except through the injected interfaces in `container.ts` and `storage.ts`. This is what lets
the entire core run under Node in Vitest with no browser mock.

## Data flow of a navigation

```
1. webRequest.onBeforeRequest fires (main_frame, blocking)
2. background gathers: url, tabId, tab.cookieStoreId, opener tab + its cookie store,
   incognito flag, container id, timestamp
3. decideNavigation(context, { settings, matcher, loopGuard }) → action
4. background executes the action:
     contain  → tabs.create({ url, cookieStoreId: <container> }) + close original
     release  → tabs.create({ url, cookieStoreId: 'firefox-default' }) + close original
     unwrap   → tabs.create({ unwrapped url, default store }) + close original
     ignore   → return undefined (load proceeds untouched)
5. non-ignore actions return { cancel: true } so the original request never hits the network
```

Cancelling _before_ the request is sent is what guarantees no Google cookie is ever attached to a
request made in the wrong cookie jar. Redirecting after the fact would be too late.

## The matcher

`UrlMatcher` builds a **reverse-label trie** from all enabled domain sets. Hosts are inserted
right-to-left (`com → google → mail`), so a lookup walks at most as many nodes as the host has
labels — typically 3–5 — regardless of whether the database holds 700 or 70,000 entries.

Key properties:

- **Subdomain matching is implicit.** Inserting `google.com` matches `mail.google.com` and
  `a.b.c.google.com`, but not `google.com.evil.com` (the walk fails at `evil`).
- **Matching uses `URL.hostname`**, never the raw string, so query strings, fragments and userinfo
  (`https://www.google.com@evil.com/`) cannot spoof a match.
- **Brand gTLDs are a single check** on the last label, which is what makes the database
  future-proof: a brand-new `something.google` host matches with no data update.
- **Results are memoised** in a 512-entry cache that is cleared wholesale when full. Bounded memory
  matters in long sessions; an unbounded cache was a deliberate non-goal.

The matcher is immutable. Changing settings constructs a new matcher (a few milliseconds) rather
than mutating the existing one, so a decision in flight can never observe a half-updated ruleset.

## The decision engine

`decideNavigation()` in `core/decision.ts` is the behavioural contract. Its check order is
deliberate and every branch has a test:

| Order | Check                           | Action                                        |
| ----- | ------------------------------- | --------------------------------------------- |
| 1     | Protection disabled or paused   | `ignore`                                      |
| 2     | Non-http(s) scheme              | `ignore`                                      |
| 3     | Private window and not opted in | `ignore`                                      |
| 4     | Container unavailable           | `ignore`                                      |
| 5     | Loop guard hit                  | `ignore`                                      |
| 6     | Google URL outside container    | `contain` (unless OAuth pass-through applies) |
| 7     | Redirector inside container     | `unwrap`                                      |
| 8     | Non-Google URL inside container | `release`                                     |
| 9     | Otherwise                       | `ignore`                                      |

### Loop prevention

The classic failure mode of container extensions is the ping-pong loop: site A redirects to Google,
we containerize, the container redirects back, we release, repeat forever.

`LoopGuard` remembers `(tabId, url)` pairs for 3 seconds and refuses to act twice on the same pair
inside that window. Properties:

- **Bounded** — hard cap on entries; expired entries are pruned, and if everything is still fresh
  the oldest half is dropped.
- **Per tab** — one tab looping never affects another.
- **Self-healing** — entries expire, so a legitimate revisit 10 seconds later still works.
- **Cleared** on tab close and on every settings change.

The `breaks a two-site ping-pong redirect chain` test simulates 20 rapid navigations and asserts
exactly one containment occurs.

## Container lifecycle

`ContainerManager.ensure()` resolves the container in this order:

1. Cached id, if it still resolves to a live container.
2. Id persisted in `storage.local` from a previous session.
3. An existing container whose **name** matches (this is how a reinstall re-adopts your cookies).
4. Create a new one.

Concurrency is handled by a single **in-flight promise**: twenty navigations racing on startup all
await the same `resolve()` call, so it is impossible to create two containers. This is covered by
the `never creates two containers under concurrent calls` test.

`contextualIdentities.onRemoved` invalidates the cached id, so deleting the container in Firefox's
UI causes the next navigation to transparently recreate it.

## Storage

`storage.local` is authoritative. `storage.sync` is an opt-in mirror; on load, the sync copy is only
adopted when it is newer _and_ the stored document itself has `behaviour.useSync === true` (so a
stale sync record from another profile cannot silently override a local choice).

- Writes are serialised through a promise chain — concurrent saves cannot interleave.
- A sync write failure (quota is small and easy to exceed) never fails the local write.
- Everything read back is passed through `sanitizeSettings()`, which rebuilds a known-good object
  field by field. Unknown keys are dropped, wrong types are replaced with defaults, lists are
  capped at 2000 entries, and every pattern must satisfy a strict LDH host regex.

## MV3 and the event page

The background script is a **non-persistent event page**. It can be suspended at any time, so:

- All durable state lives in `storage.local`.
- Ephemeral state (loop guard, compiled matcher) is cheap to rebuild — `init()` is idempotent and
  awaited by every entry point.
- Statistics writes are debounced by 5 seconds so a navigation burst does not hammer storage.

Firefox retains blocking `webRequest` under MV3 for privacy extensions, which is why the manifest
declares `webRequest` + `webRequestBlocking` rather than `declarativeNetRequest` — DNR cannot make
a container decision that depends on the _current tab's_ cookie store.

## Icon

The icon set is **generated from source** by `scripts/make-icons.py` rather than committed as
opaque binaries, so it is reviewable in a diff, reproducible, and re-tintable without a design tool.

- **Mark:** a geometric capital `G` inside a dashed ring. The dashes carry the meaning — a container
  boundary that quarantines what is inside it, rather than merely circling it.
- **Palette:** indigo `#1A1042` plate, cyan `#22E9DB` mark. Deliberately _not_ Google's four-colour
  palette: using Google's actual logo colours on an unaffiliated add-on invites a trademark
  objection during AMO review.
- **Construction:** the `G` is drawn subtractively (filled disc, punched counter, removed aperture,
  crossbar added back) instead of as a stroked arc. A stroked arc closes up into an unreadable blob
  at 16px; the subtractive build keeps the counter genuinely open.
- **Optical compensation:** detail is size-aware. At 16px the dashed ring becomes noise, so small
  sizes fall back to a solid ring with a heavier mark. Larger sizes use a rounded-square plate to
  match platform icon conventions; small sizes use a disc, which reads better in the toolbar.

Regenerate with `python3 scripts/make-icons.py`. Only the sizes referenced by the manifest are
copied into `dist/`; `icon-512.png` is a master for the AMO listing and README.

## Project identity

Two values are permanent and enforced by `scripts/verify-manifest.mjs`:

| Value           | Setting                             | Why it is pinned                                                                                                                                                                                                                                              |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension id    | `g-container@astarling-x.github.io` | Firefox and AMO use this as the add-on's identity. Changing it after publication makes AMO treat the upload as a _different_ add-on: existing users get no update, and a fresh install creates a new container, orphaning their cookies, logins and settings. |
| Canonical owner | `astarling-x`                       | The project previously lived under `mheci`, which has been deleted. `scripts/check-links.mjs` fails CI if a link to it reappears — a dead vulnerability-reporting link in SECURITY.md would be a genuine hazard.                                              |

If the project ever moves accounts again, move the _repository_, not the extension id.

## Invariants

Violating any of these is a bug:

1. A `contain` action targets the container cookie store and nothing else.
2. The extension never leaves the user with zero tabs where they had one — a replacement tab is
   always created _before_ the original is closed.
3. `decideNavigation` performs no I/O and is synchronous.
4. `core/` never imports the `browser` global directly.
5. Every persisted document passes `sanitizeSettings()` before use.
6. No code path performs a network request.

## Performance budget

Enforced by `test/performance.test.ts`:

| Operation                       | Budget                  |
| ------------------------------- | ----------------------- |
| Matcher build (~700 hosts)      | < 150 ms                |
| 50,000 unique URL matches       | < 2000 ms               |
| 100,000 cached matches          | < 500 ms                |
| Match cache size                | ≤ 512 entries           |
| Loop guard under 50k operations | < 2000 ms, bounded size |
