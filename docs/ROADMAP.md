# Roadmap

Priorities are ordered by user impact and risk reduction, not by novelty. Anything that increases
runtime complexity has to earn its place — reliability is the product.

## v1.0 — Shipped

- [x] Automatic containment of all Google properties
- [x] 700+ host domain database with ccTLD and brand-gTLD expansion
- [x] Two-way containment (release non-Google pages)
- [x] Redirector unwrapping and OAuth pass-through
- [x] Loop prevention
- [x] Options page, popup, context menus
- [x] Always / never lists, exceptions
- [x] Backup, restore, reset, Sync
- [x] Diagnostics with URL tester
- [x] 256 tests, CI, complete documentation

## v1.1 — Polish and localisation

- [ ] **`_locales` internationalisation** with `browser.i18n`. English, then community translations.
- [ ] **Per-rule exception UI** exposing the `ExceptionRule` metadata (note, enabled toggle,
      creation date) that the data model already supports.
- [ ] **Keyboard shortcuts** (`commands`) for move-tab-in / move-tab-out / pause.
- [ ] **Onboarding page** shown once on install, explaining what will change and what will not.
- [ ] **Accessibility pass** on both UI surfaces: focus order, ARIA labelling, contrast audit.
- [ ] **AMO listing**: screenshots, store copy, signed release.

## v1.2 — Smarter matching

- [ ] **Opt-in sub-resource reporting** — a diagnostics-only view of Google sub-resources a page
      loaded, so users can see what is embedded where. Reporting only; no blocking.
- [ ] **Rule import from Facebook Container** style lists for users migrating between tools.
- [ ] **Bulk rule editing** (paste a list, edit as text) in Options.
- [ ] **Redirect-chain tracing** in diagnostics: show the last N decisions with their reasons, to
      make "why was this contained?" self-service.

## v1.3 — Multiple containers

Requested frequently; deliberately scheduled late because it multiplies the state space.

- [ ] **Separate Work and Personal Google containers**, chosen by account or by rule.
- [ ] **Per-container rule sets**.
- [ ] Migration path that keeps single-container users unaffected by default.

## v2.0 — Generalisation

- [ ] **Provider plug-ins**: the same engine driving Microsoft, Meta or Amazon containers, with the
      domain database as the only per-provider data.
- [ ] **Community domain lists** with signed, verifiable updates — only if a design exists that
      preserves the "no network requests" property, e.g. shipping lists in the add-on update itself.

## Explicit non-goals

These will not be built, so nobody wastes time proposing them:

- **Content or ad blocking.** Use uBlock Origin. Containment and blocking are different jobs, and
  merging them makes both worse.
- **Any telemetry or analytics**, even anonymised and opt-in.
- **Remote configuration or remote code**, in any form.
- **Chrome/Edge support.** Containers are a Firefox feature; there is nothing to port to.
- **A rules engine with regexes and boolean logic.** Host and host+path prefixes cover real needs;
  a mini-language would be a footgun and a security surface.
- **Automatic Google account switching.** Out of scope and fragile.

## Maintenance commitments

- **Quarterly** domain database review against Google's product list.
- **Within one release** of a new Firefox ESR, verify compatibility and bump `strict_min_version`
  only when a genuinely needed API requires it.
- **Security reports** triaged within 72 hours (see [SECURITY.md](../SECURITY.md)).
- **Dependency updates** monthly via Dependabot; runtime dependencies remain at zero.

## How to influence this

Open a [Discussion](https://github.com/astarling-x/g-container/discussions) for ideas, or an
[Issue](https://github.com/astarling-x/g-container/issues) for concrete bugs and missing domains. Missing
or over-eager domains are the highest-value reports and are usually fixed within days.
