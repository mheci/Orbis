# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/astarling-x/g-container/security/advisories/new)
on this repository.

Please include:

- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- affected version and Firefox version,
- any suggested fix.

**What to expect**

| Stage                    | Target                                  |
| ------------------------ | --------------------------------------- |
| Acknowledgement          | 72 hours                                |
| Initial assessment       | 7 days                                  |
| Fix for a critical issue | 14 days                                 |
| Fix for other issues     | next release                            |
| Public disclosure        | after a fix ships, coordinated with you |

Reporters are credited in the advisory and `CHANGELOG.md` unless they prefer to stay anonymous.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Threat model

### What G-Container defends against

- **Cross-site tracking via Google cookies.** Google's cookies live in a separate jar and are not
  sent with requests made in normal browsing.
- **Session bleed in the other direction.** Cookies set during normal browsing are not sent to
  Google properties.
- **Accidental de-anonymisation.** Being signed into Google no longer links your identity to
  activity on unrelated sites through cookie-based joins.
- **Rule tampering via imported settings.** Every imported document is fully rebuilt and validated.

### What it explicitly does NOT defend against

Be honest with yourself about these:

- **IP-address tracking.** Your IP is unchanged. Use a VPN or Tor if that matters.
- **Browser fingerprinting.** Containers do not alter your fingerprint. Use Firefox's
  resist-fingerprinting or the Tor Browser.
- **Data you hand over voluntarily.** Anything you do while signed into Google is visible to Google.
- **Third-party Google scripts on other sites.** Analytics and reCAPTCHA sub-resources still load
  where sites embed them; they simply cannot read the Google container's cookie jar. Pair with
  uBlock Origin or Firefox's Enhanced Tracking Protection for blocking.
- **Malicious or compromised extensions** with broader permissions than ours.
- **A compromised operating system or browser binary.**

## Security properties of the implementation

- **No network activity.** The extension never contacts any server. The domain database is compiled
  into the bundle at build time.
- **No remote code.** No `eval`, no `new Function`, no dynamically injected scripts, no CDN.
- **No content scripts.** Nothing is injected into pages; no DOM is read.
- **No runtime dependencies.** Zero third-party code ships in the add-on, minimising supply-chain
  risk. Dev dependencies never reach the user.
- **Least privilege.** Seven permissions, each justified in [docs/PERMISSIONS.md](docs/PERMISSIONS.md);
  CI fails the build if an undocumented permission is added.
- **Input validation everywhere.** Settings read from storage or imported from a file are rebuilt
  field by field: unknown keys dropped, types checked, lists capped at 2000 entries, and every host
  pattern validated against a strict LDH regex.
- **URL parsing, never string matching.** Decisions use `URL.hostname`, so
  `https://google.com.evil.com/`, `https://evil.com/?u=google.com` and
  `https://www.google.com@evil.com/` are all correctly treated as non-Google. Each has a test.
- **No user data in logs.** Diagnostics contain counts, versions and error strings — not URLs or
  browsing history.
- **Statistics are local integers** and can be disabled.

## Known limitations

1. **Private windows are excluded by default.** Firefox cannot move a tab between a private window
   and a container, so the feature is opt-in and behaves differently there.
2. **A brief tab replacement is visible.** Containment cancels the load and re-opens the URL in the
   container. That is inherent to the mechanism (Facebook Container behaves the same way) and is
   what guarantees no request is ever sent from the wrong cookie jar.
3. **OAuth pass-through is a deliberate trade-off.** Letting third-party sign-in flows complete
   outside the container keeps those sites working. Disable it in Options for maximum strictness.
4. **Sub-resources are not containerized.** Only top-level navigations are; embedded Google
   resources load in their host page's context, which is the correct behaviour for the web to work,
   and they remain partitioned by Firefox's own state partitioning.

## Verifying a build

The build is reproducible: `npm ci && npm run package` from a given tag yields a byte-identical zip
(timestamps in the archive are pinned). You can compare a release artifact against your own build,
or read `dist/` directly — the bundle is unminified in development builds
(`NODE_ENV=development npm run build:js`).
