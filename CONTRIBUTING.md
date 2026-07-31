# Contributing

Efficient, focused PRs. Repo owned by `mheci`.

## Setup

```sh
git clone https://github.com/mheci/Orbis.git
cd Orbis
npm ci
npm run check
```

Requires Node 20+, npm 10+, Firefox 140+, geckodriver.

## PR Requirements

- One problem per PR, clear behavior and failure handling
- Tests for regression, preserve containment ordering and ownership
- Update docs/changelog if user-visible
- Measurements for perf-sensitive changes (blocking path must stay synchronous)
- No unrelated formatting or deps

Pre-review:

```sh
npm audit --audit-level=high
npm run check
npm run test:coverage
npm run package
```

## Engineering Rules

- Keep Firefox APIs behind container manager and storage layers
- Core pure: decisions take input → output, no side effects, no browser access – testable in Node
- Data not code: Google addresses in JSON, not TypeScript
- Fail safe, not stuck: corrupt storage → defaults, container deleted → recreate, API throws → do nothing
- Minimal perms: each permission documented in PERMISSIONS.md
- No polling: events + one-shot alarms only
- Bounded: retries, timers, listeners, history, caches
- Never log/persist URLs, hostnames, titles, page content
- No telemetry, remote code, host perms, runtime deps

New blocking category needs: Firefox docs, cross-container safety test, recovery coverage, real-Firefox test.

## Security

Use private process in SECURITY.md, not public issues. Licensed MPL-2.0.
