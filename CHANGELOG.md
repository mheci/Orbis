# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/mheci/g-container/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mheci/g-container/releases/tag/v1.0.0
