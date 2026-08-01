# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- “Sign in with Google” on third-party sites is now an OAuth bridge: the handshake runs inside
  the Google container (so your Google session is reused and Google cookies never touch your
  default browsing jar), and the callback is released back into the relying party’s own cookie
  jar so the sign-in completes as if nothing happened.

## [2.0.3] - 2026-08-01

### Added

- A fingerprint-globe brand icon (`src/icons/icon.svg`), rendered to every PNG size, replacing
  the previous placeholder icon set.

### Changed

- The whole UI is rebranded to a deep-space indigo palette: popup, options and onboarding share
  the same accent tokens, the popup settings button is now a crisp inline SVG instead of a
  decorative character, and the options and onboarding pages gained branded headers,
  backgrounds and orbit-ring decoration.
- The release pipeline now fails the whole run when AMO signing fails with credentials
  configured, instead of silently publishing a release without the signed XPI.
- Signed XPIs are renamed to the canonical `orbis-<version>-signed.xpi` before publication,
  and the checksums file no longer lists an artifact twice.

## [2.0.2] - 2026-08-01

### Added

- Seven additional verified Google-owned domains (`chrome.com`, `chromecast.com`, `angular.io`,
  `dart.dev`, `flutter.dev`, `go.dev`, `fuchsia.dev`), each covered by a matcher test.
- Move-tab actions are now offered from the tab strip context menu as well as the page menu.
- GitHub dependency review on pull requests: changed dependencies are checked against the
  advisory database and fail the build above high severity.
- Release artifacts now include deterministic source archives and a `SHA256SUMS.txt`.

### Changed

- Release signing uses `--channel=unlisted`. The add-on is signed by Mozilla's signing service
  but is never submitted or published to addons.mozilla.org; Orbis is distributed exclusively
  through GitHub Releases.
- Signed XPIs are verified (`META-INF/mozilla.rsa`) before release, and CI builds are checked
  for byte-for-byte reproducibility across two clean builds.
- The extension-page CSP is declared explicitly (`script-src 'self'; object-src 'none';`) and
  enforced by the manifest verification step, so a future weakening fails the build.
- The onboarding page loads its script as an ES module, matching the popup and options pages,
  and no longer uses emoji as decoration.
- The blocking navigation listener now fetches the tab and the container id in parallel, so a
  page load waits on one API round-trip instead of two.
- Documentation corrected for accuracy: the changelog's historical entries were restored, the
  README and INSTALL now list the commands that actually exist, and the architecture, roadmap
  and test-count references were brought in line with the code.

### Removed

- Dead code: a write-only tab-tracking set and an unused classifier accessor.

## [2.0.1] - 2026-07-31

### Changed

- Version bumped for the signed mass-production release of the Orbis rebrand.

## [2.0.0] - 2026-07-31

Rebrand from G-Container to Orbis.

### Added

- Four-step onboarding page shown on first install.
- Keyboard commands: new Orbis tab, open Google in Orbis, and a popup shortcut.
- Popup and options pages rebuilt around the new identity.

### Changed

- Extension renamed from G-Container to Orbis. The extension id is now pinned to
  `orbis@mheci.github.io`. An extension id is a permanent identity key: changing it after
  publication orphans existing installs, so this was done once, deliberately, while the add-on
  has no published users. It is enforced by the build from here on.
- Project moved to the `mheci` GitHub account; clone URLs, badges and reporting paths updated.

## [1.1.0] - 2026-07-28

Adds blocking of Google trackers embedded in other websites, which is the piece that turns
cookie separation into an actual defence against being followed around the web.

### Added

- **Blocking Google trackers embedded in other websites.** Separating cookies never stopped the
  request being made, so a news site loading Google Analytics still told Google your IP address and
  which page you were reading. Those requests are now cancelled before they leave the machine.

  Facebook Container can block every Meta resource on other sites because almost nothing depends on
  Meta code loading. Google is not comparable, so resources are classified instead. Standard mode,
  the default, blocks analytics, advertising and social widgets. Fonts, hosted script libraries,
  maps, embedded players, reCAPTCHA and sign-in are left alone, because blocking them breaks pages
  rather than protecting anyone. Strict mode blocks those too and says plainly that sites will
  break. Sign-in and reCAPTCHA are never blocked in any mode, since locking someone out of their
  own account is not an acceptable outcome.

  The popup shows how many were blocked on the current page and can exempt a single site in one
  click. No new permissions were needed.

### Changed

- **Rewrote all documentation.** The README now explains what the extension does in plain language,
  leading with the problem it solves rather than a feature list. Across every markdown file:
  removed emoji, decorative symbols, ASCII diagrams, check marks and em-dashes, and replaced jargon
  with ordinary words. Every number quoted in the docs was checked against the code rather than
  carried over.

### Added

- **Security scanning workflow** using established tooling: CodeQL, Trivy, Gitleaks, OSV Scanner and
  Zizmor, with results published as SARIF to the repository Security tab. Two invariants are now
  enforced as build failures: `npm audit --omit=dev` must be clean, and the runtime dependency count
  must stay at zero.
- `.gitleaks.toml` with rules for GitHub PATs and AMO JWT credentials, verified against a negative
  control so a passing scan is meaningful.
- **Supply-chain hardening**, driven by the scanners' own findings: all 31 GitHub Action references
  are pinned to immutable commit SHAs (a tag can be moved; a SHA cannot), `actions/checkout` runs
  with `persist-credentials: false` so the token is not left in `.git/config` for later steps, and
  Dependabot has a 7-day cooldown so a compromised release is likely yanked before it is adopted.

### Fixed

- **Cleared all dependency vulnerabilities**, including a critical advisory in `vitest`
  (CVE-2026-47429). `vitest` and `@vitest/coverage-v8` moved to v4, the coordinated upgrade
  tracked in the toolchain issue, which installs cleanly now, and a targeted npm `override` forces
  the patched `brace-expansion@5.0.8` transitively rather than forcing an `eslint` major for a
  dev-only DoS advisory. `npm audit` now reports zero vulnerabilities at every level.

### Changed

- **Commit history rewritten to a single maintainer identity.** Dependabot
  authorship is preserved, since rewriting it would misrepresent who wrote those changes. File
  contents are byte-identical, the tree hash is unchanged and only commit metadata differs.
- Hardened workflows: explicit least-privilege `permissions` blocks on every job.

### Removed

- `PROJECT_SUMMARY.md`, a handover note that duplicated the README and CHANGELOG and had gone
  stale.

## [1.0.1] - 2026-07-28

First **Mozilla-signed** release. The signed `.xpi` installs permanently on any Firefox channel,
including Release and Beta, with no `about:config` changes.

### Changed

- **Project moved to its own GitHub account.** The previous repository location has been
  deleted; all clone URLs, badges, issue links and the private security-reporting link now point at
  `github.com/mheci/Orbis`.
- **Extension id changed** from `orbis@mheci.github.io` to `orbis@mheci.github.io`.
  This was done deliberately while the add-on has no published users. The id is a permanent identity
  key: had it been changed after an AMO release, Firefox would have treated the update as a
  different add-on and orphaned every user's container, cookies and settings. It is now pinned by
  `scripts/verify-manifest.mjs` and must not change again.

### Fixed

- **`.amo-upload-uuid` is no longer packaged.** `web-ext sign` writes this upload-resume state file
  into the source directory, and the packager would have shipped it to every user, leaking an
  internal AMO upload id. It is now excluded along with other build-machine detritus.

- **Navigation is no longer cancelled when the replacement tab cannot be created.** If
  `tabs.create` failed, container deleted mid-navigation, window closing or resource
  exhaustion, the original load was still cancelled, stranding the user on a blank dead tab. Containment is now
  best-effort: on failure the navigation is allowed through uncontained, which is the far less
  harmful outcome. Found by the new background-worker tests.
- **The popup no longer renders blank when the background worker is unreachable.** Worker errors are
  returned as `{ error }` rather than thrown, and the popup treated that object as valid state.
  Errors now surface as a readable message.
- **A failed save in the options page is now reported** instead of silently doing nothing.
- Added `fitbit.com`, `nest.com`, `tenor.com`, `kaggle.com`, `looker.com`, `mandiant.com`,
  `widevine.com`, `apigee.com` and other Google acquisitions that remain on their own brand
  domains, these were being missed entirely.

### Added

- `test/background.test.ts` and `test/mock-browser.ts`. 23 integration tests covering the
  background worker, which previously had no test coverage at all. Coverage now includes
  `src/background/**`.
- `scripts/check-links.mjs`. CI gate that fails the build if a link to the retired account
  reappears anywhere in the tree. A dead security-reporting link is a real hazard, so this is
  enforced rather than trusted to review.
- Weekly scheduled maintenance workflow that rebuilds from a clean checkout, re-runs Mozilla's
  validator against current rules and opens (or comments on) a single tracking issue on failure.
- Dependabot for dev dependencies and GitHub Actions, grouped to keep the review queue small.

## [1.0.0] - 2026-07-28

First production release.

### Added

**Core isolation**

- Automatic containment of every Google-owned property into a dedicated Firefox Container.
- Two-way containment: non-Google pages opened inside the container are pushed back out.
- Redirector unwrapping, `google.com/url?q=`, `youtube.com/redirect?q=` and similar links land on
  the real destination outside the container.
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

[Unreleased]: https://github.com/mheci/Orbis/compare/v2.0.3...HEAD
[2.0.3]: https://github.com/mheci/Orbis/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/mheci/Orbis/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/mheci/Orbis/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/mheci/Orbis/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/mheci/Orbis/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mheci/Orbis/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mheci/Orbis/releases/tag/v1.0.0
