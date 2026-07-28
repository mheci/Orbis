# Testing

```bash
npm test              # run everything (292 tests)
npm run test:watch    # watch mode
npm run test:coverage # coverage with thresholds enforced
npm run ci            # lint + typecheck + test + package (what CI runs)
```

## Strategy

The core is a set of pure modules with injected dependencies, so **no browser mock is required**.
Tests run in plain Node under Vitest, which keeps them fast (~2 s for the whole suite) and means
there is no excuse for skipping them before a commit.

| Suite                | File                       | Covers                                                                                                              |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain matching      | `test/matcher.test.ts`     | 130+ URLs: every service class, ccTLDs, brand gTLDs, look-alikes, schemes, precedence, redirectors, OAuth detection |
| Navigation decisions | `test/decision.test.ts`    | contain / release / unwrap / ignore, pause, private windows, OAuth pass-through, loop prevention                    |
| Settings             | `test/settings.test.ts`    | defaults, sanitisation of hostile input, merging, migration, backup round-trip                                      |
| Storage              | `test/storage.test.ts`     | persistence, corruption recovery, sync precedence, concurrent writes, failing backends                              |
| Containers           | `test/container.test.ts`   | creation, reuse, concurrency, deletion recovery, rename, missing API                                                |
| Domain database      | `test/domain-db.test.ts`   | expansion correctness, duplicates, formatting, size floors                                                          |
| Performance          | `test/performance.test.ts` | build time, 50k matches, cache bounds, loop guard memory                                                            |

Coverage thresholds are enforced for `src/core/**` and `src/background/**` at 80 % lines/functions/
statements and 75 % branches; CI fails below them. Current: **99 % core**, **72 % background**
(the untested remainder is context-menu and listener registration, which is exercised manually).

The background worker is tested through `test/mock-browser.ts`, a behavioural mock that models real
Firefox semantics — `tabs.get` rejects for a missing tab, `contextualIdentities.get` throws for an
unknown id, and `tabs.create` can be made to fail on demand. Mocks that return convenient values
instead of realistic ones would hide exactly the bugs this layer is prone to.

## What the security-relevant tests assert

These exist because getting them wrong is a privacy bug, not a cosmetic one:

- `https://google.com.evil.com/` → **not** contained (suffix-spoofing).
- `https://evil.com/?redirect=https://mail.google.com` → **not** contained (query-string spoofing).
- `https://www.google.com@evil.com/` → **not** contained (userinfo spoofing).
- `javascript:`, `data:`, `file:`, `moz-extension:` → never contained.
- Imported backups containing `javascript:alert(1)` as a rule → silently dropped.
- Oversized imports (5000 rules) → capped at 2000.
- 20 rapid ping-pong navigations → exactly **one** containment.
- `tabs.create` failing → navigation is **allowed through**, not cancelled (no stranded blank tab).
- 25 concurrent `ensure()` calls → exactly **one** container created.

## Manual QA checklist

Automated tests cannot exercise real Firefox tab plumbing. Run this list before tagging a release,
using a fresh profile (`npx web-ext run` or `about:debugging`).

### Basic containment

- [ ] Type `google.com` in the address bar → opens in the Google container (coloured tab strip).
- [ ] Click a Google result → stays in the container.
- [ ] Click a non-Google result → leaves the container.
- [ ] Open `youtube.com` from a normal tab → moves into the container.
- [ ] `youtu.be/<id>` short link → container.
- [ ] Bookmark a Gmail URL, click it → container.
- [ ] Middle-click / Ctrl+click a Google link → container, correct tab position.
- [ ] `target="_blank"` and `window.open()` Google links → container.

### Login and session

- [ ] Sign into Google inside the container; open a normal tab to `google.com` → also contained,
      same session.
- [ ] Sign out → session ends; no residual login in normal browsing.
- [ ] A third-party site's "Sign in with Google" completes and returns to that site logged in.
- [ ] Embedded YouTube player on a third-party page still plays (it is a sub-resource, untouched).

### Edge cases

- [ ] Google search → external link → lands outside the container (redirector unwrapping).
- [ ] A site that redirects through Google and back does **not** loop; the tab settles.
- [ ] Delete the container in Firefox settings → next Google visit recreates it.
- [ ] Rename the container in Options → tab strip label updates, session preserved.
- [ ] Private window: nothing happens by default; enabling the option makes it act.
- [ ] Offline / DNS failure → error page shows normally, no loop, no tab churn.
- [ ] 50 tabs open, restart Firefox → session restores, no duplicated tabs.

### Settings

- [ ] Add a "never" rule for `docs.google.com` → it opens outside the container.
- [ ] Add an "always" rule for a non-Google host → it opens inside.
- [ ] Toggle the _Advertising & measurement_ set → behaviour changes immediately.
- [ ] Pause 30 minutes → badge shows `off`, no containment; resume restores it.
- [ ] Export, reset, re-import → all settings return.
- [ ] Import a truncated/garbage JSON file → clear error, settings unchanged.
- [ ] Diagnostics → _Test a URL_ reports the correct matching rule.

### Upgrade

- [ ] Install an older build, configure it, upgrade in place → settings and container survive.
- [ ] Uninstall and reinstall → the existing container is re-adopted by name (cookies intact).

## Adding tests

- A bug fix **must** come with a regression test that fails before the fix.
- A new domain **must** come with a matcher assertion.
- A behaviour change **must** update `test/decision.test.ts`; that file is the executable spec.
