# G-Container — delivery summary

**Repository:** https://github.com/astarling-x/g-container (sole maintained home)
**Release:** [v1.0.0](https://github.com/astarling-x/g-container/releases/tag/v1.0.0) · `g_container-1.0.0.zip` (23.9 KiB)
**Status:** CI green on Node 20 + 22 · 256/256 tests · Mozilla AMO validator **0 errors, 0 warnings, 0 notices**

---

## What was built

A production-grade Firefox Multi-Account Containers extension that automatically isolates every
Google-owned property into one dedicated container — the Google equivalent of Mozilla's Facebook
Container, with a larger domain database and far more configurability.

| Metric                | Value                            |
| --------------------- | -------------------------------- |
| Host patterns matched | **936**                          |
| Country domains       | 194 suffixes × 4 base labels     |
| Tests                 | **256**, all passing (~2 s)      |
| Core coverage         | 98% statements / 92% branches    |
| Matcher build time    | **2 ms**                         |
| Packaged size         | 23.9 KiB                         |
| Runtime dependencies  | **0**                            |
| Permissions           | 7, each documented + CI-enforced |
| Commits               | 14 atomic Conventional Commits   |

## Architecture in one line

`webRequest event → gather facts → decideNavigation() (pure) → execute action`

The decision engine is a **pure, synchronous, side-effect-free function**. That single choice is
what makes the behaviour deterministic, race-free and exhaustively testable — the whole core runs
under Node with no browser mock.

## Requirements coverage

| Requirement                   | How it was met                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Isolate all Google properties | 936 patterns across 4 switchable sets                                                         |
| Future-proof matching         | Brand gTLD rule: any `*.google` / `*.youtube` host matches with no update                     |
| Maintainable domain DB        | 6 JSON files + JSON Schema + CI validation; adding a domain touches no code                   |
| No redirect loops             | Bounded, per-tab, self-expiring `LoopGuard`; test proves 20 rapid navigations → 1 containment |
| No race conditions            | Shared in-flight promise; test proves 25 concurrent calls → 1 container                       |
| No brittle URL matching       | Reverse-label trie on `URL.hostname`; suffix/query/userinfo spoofing all rejected by test     |
| Never lose tabs               | Replacement tab always created before the original closes                                     |
| Survive updates/deletion      | Container re-adopted by name; schema migration; corruption-tolerant storage                   |
| OAuth / login flows           | Pass-through keeps third-party "Sign in with Google" working                                  |
| Exceptions & whitelists       | Always/never lists with host or host+path granularity, documented precedence                  |
| Import/export                 | Versioned JSON, backward compatible, fully sanitised on import                                |
| Least privilege               | 7 permissions; `verify-manifest.mjs` fails the build on any undocumented one                  |
| No telemetry / remote code    | Zero network requests, zero content scripts, zero runtime deps                                |
| CI/CD                         | Lint, typecheck, test, coverage, build, manifest verify, JSON validate, package, AMO lint     |
| Documentation                 | 10 documents covering architecture, domains, testing, permissions, security, roadmap          |

## Three bugs the tooling caught during development

Worth noting, because they are the reason the gates exist:

1. **Input validation hole** — the settings sanitiser accepted `javascript:alert(1)` as a rule
   pattern. Caught by a test, fixed with a strict LDH host regex.
2. **AMO compliance** — the manifest description exceeded the 132-character store limit. Caught by
   `verify-manifest.mjs`, which now also enforces the `data_collection_permissions` declaration.
3. **Duplicate data** — a duplicated `rs` country suffix. Caught by `validate-json.mjs`.

## Deliberate trade-offs

- **Ad/measurement and user-content-hosting domains ship OFF by default.** Containerizing
  `doubleclick.net` or `web.app` at the top level breaks unrelated sites; cookie isolation is
  already achieved by the container's separate jar. One click enables them.
- **OAuth pass-through is ON by default.** Strict containment would break "Sign in with Google"
  across the web. Users who want maximum strictness can disable it.
- **Firefox 140+ minimum.** AMO now requires `data_collection_permissions`, which needs FF140.
  Chosen over shipping with a validator warning.
- **Blocking `webRequest`, not `declarativeNetRequest`.** DNR cannot express "does this tab's
  cookie store match the container?" — that is dynamic per-tab state. Documented for AMO reviewers.

## Project management set up

- 4 milestones (v1.1, v1.2, v1.3, rolling domain maintenance)
- 8 detailed issues with scope, acceptance criteria and design constraints
- Issue templates (missed domain, bug) + PR template + Discussions enabled
- 8 labels, repo topics, squash/rebase merge policy

## Next steps

1. Load `dist/manifest.json` via `about:debugging` and run the manual QA checklist in
   `docs/TESTING.md` — automated tests cannot exercise real Firefox tab plumbing.
2. Add `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` repo secrets; the release workflow then signs automatically.
3. Work issue #5 for the AMO listing (screenshots, store copy, reviewer notes).
