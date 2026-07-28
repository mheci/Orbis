# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Security scanning workflow** using established tooling: CodeQL, Trivy, Gitleaks, OSV Scanner and
  Zizmor, with results published as SARIF to the repository Security tab. Two invariants are now
  enforced as build failures: `npm audit --omit=dev` must be clean, and the runtime dependency count
  must stay at zero.
- `.gitleaks.toml` with rules for GitHub PATs and AMO JWT credentials, verified against a negative
  control so a passing scan is meaningful.

### Changed

- **Commit history rewritten to a single maintainer identity** (`astarling-x`). Dependabot
  authorship is preserved, since rewriting it would misrepresent who wrote those changes. File
  contents are byte-identical — the tree hash is unchanged and only commit metadata differs.
- Hardened workflows: explicit least-privilege `permissions` blocks on every job.

### Removed

- `PROJECT_SUMMARY.md` — a handover note that duplicated the README and CHANGELOG and had gone
  stale.

## [1.0.1] — 2026-07-28

First **Mozilla-signed** release. The signed `.xpi` installs permanently on any Firefox channel,
including Release and Beta, with no `about:config` changes.

### Changed

- **Project moved to the `astarling-x` GitHub account.** The previous `mheci` repository has been
  deleted; all clone URLs, badges, issue links and the private security-reporting link now point at
  `github.com/astarling-x/g-container`.
- **Extension id changed** from `g-container@mheci.github.io` to `g-container@astarling-x.github.io`.
  This was done deliberately while the add-on has no published users. The id is a permanent identity
  key: had it been changed after an AMO release, Firefox would have treated the update as a
  different add-on and orphaned every user's container, cookies and settings. It is now pinned by
  `scripts/verify-manifest.mjs` and must not change again.

### Fixed

- **`.amo-upload-uuid` is no longer packaged.** `web-ext sign` writes this upload-resume state file
  into the source directory, and the packager would have shipped it to every user, leaking an
  internal AMO upload id. It is now excluded along with other build-machine detritus.

- **Navigation is no longer cancelled when the replacement tab cannot be created.** If
  `tabs.create` failed — container deleted mid-navigation, window closing, resource exhaustion —
  the original load was still cancelled, stranding the user on a blank dead tab. Containment is now
  best-effort: on failure the navigation is allowed through uncontained, which is the far less
  harmful outcome. Found by the new background-worker tests.
- **The popup no longer renders blank when the background worker is unreachable.** Worker errors are
  returned as `{ error }` rather than thrown, and the popup treated that object as valid state.
  Errors now surface as a readable message.
- **A failed save in the options page is now reported** instead of silently doing nothing.
- Added `fitbit.com`, `nest.com`, `tenor.com`, `kaggle.com`, `looker.com`, `mandiant.com`,
  `widevine.com`, `apigee.com` and other Google acquisitions that remain on their own brand
  domains — these were being missed entirely.

### Added

- `test/background.test.ts` and `test/mock-browser.ts` — 23 integration tests covering the
  background worker, which previously had no test coverage at all. Coverage now includes
  `src/background/**`.
- `scripts/check-links.mjs` — CI gate that fails the build if a link to the retired account
  reappears anywhere in the tree. A dead security-reporting link is a real hazard, so this is
  enforced rather than trusted to review.
- Weekly scheduled maintenance workflow that rebuilds from a clean checkout, re-runs Mozilla's
  validator against current rules and opens (or comments on) a single tracking issue on failure.
- Dependabot for dev dependencies and GitHub Actions, grouped to keep the review queue small.

## [1.0.0] — 2026-07-28

First production release.

### Added

**Core isolation**

- Automatic containment of every Google-owned property into a dedicated Firefox Container.
- Two-way containment: non-Google pages opened inside the container are pushed back out.
- Redirector unwrapping — `google.com/url?q=…`, `youtube.com/redirect?q=…` and friends land on the
  real destination outside the container.
- OAuth pass-through so third-party "Sign in with Google" flows keep working.
- Loop prevention with a bounded, per-tab, self-expiring guard.

**Domain database**

- 700+ host patterns across four switchable sets (Google core, YouTube, advertising, hosting).
- ~180 country suffixes expanded automatically across `google`, `youtube`, `blogspot`, `gstatic`.
- Brand gTLD matching (`.google`, `.youtube`, `.chrome`, `.android`, …) so future Google services
  are covered with no update.
- JSON-only domain data with a JSON Schema and CI validation.

**Configuration**

- Options page with General, Domains, Rules & exceptions, Backup & data and Diagnostics tabs.
- Configurable container name, colour and icon, applied in place without losing the session.
- Always-containerize and never-containerize lists with host or host+path granularity.
- Pause protection for 30 minutes, or disable entirely.
- Versioned JSON backup export/import with full sanitisation.
- Optional Firefox Sync mirroring with graceful fallback to local-only.
- Built-in URL tester that reports exactly which rule matched.

**Interface**

- Popup showing protection status, the current site's verdict, container state and statistics, with
  one-click tab moves and pause/resume.
- Context-menu entries: open link in container, always/never containerize this site, move tab
  in/out.
- Toolbar badge indicating paused or disabled protection.

**Reliability**

- Automatic recovery when the container is deleted, renamed, or its id changes.
- Container re-adoption by name after reinstall, preserving cookies and logins.
- Race-free container creation via a shared in-flight promise.
- Corruption-tolerant storage with serialised writes and schema migration.

**Quality**

- 256 automated tests: matching, decisions, settings, storage, containers, domain data, performance.
- Strict TypeScript, ESLint, Prettier, coverage thresholds.
- GitHub Actions CI: lint, typecheck, test, build, manifest verification, JSON validation, packaging.
- Full documentation set: README, INSTALL, ARCHITECTURE, DOMAIN_DATABASE, TESTING, PERMISSIONS,
  CONTRIBUTING, SECURITY, ROADMAP.

### Security

- No network requests, no telemetry, no remote code, no content scripts, no runtime dependencies.
- Seven permissions, each documented and enforced by a CI check.
- Hostname-based matching that resists suffix, query-string and userinfo spoofing.

[Unreleased]: https://github.com/astarling-x/g-container/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/astarling-x/g-container/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/astarling-x/g-container/releases/tag/v1.0.0
