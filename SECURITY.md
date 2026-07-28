# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/astarling-x/g-container/security/advisories/new)
on this repository.

Useful things to include:

- What the problem is and what it allows
- How to reproduce it
- Which version of the extension and of Firefox
- A suggested fix, if you have one

What to expect:

| Stage                      | Target                             |
| -------------------------- | ---------------------------------- |
| Acknowledgement            | 72 hours                           |
| First assessment           | 7 days                             |
| Fix for something critical | 14 days                            |
| Fix for anything else      | next release                       |
| Public disclosure          | after a fix ships, agreed with you |

Reporters are credited in the advisory and changelog unless they would rather not be.

## Supported versions

| Version   | Supported |
| --------- | --------- |
| 1.x       | Yes       |
| Below 1.0 | No        |

## What this protects against

**Being tracked across sites through Google cookies.** Google's cookies live in a separate
compartment and are not sent with ordinary browsing.

**Leaking the other direction.** Cookies from ordinary browsing are not sent to Google.

**Being identified by association.** Staying signed into Google no longer links your identity to
activity on unrelated sites through cookie matching.

**Tampered settings.** Every imported settings file is rebuilt and validated before use.

## What it does not protect against

Being honest about this matters more than the marketing would.

**Your IP address.** Unchanged. Use a VPN or Tor if that matters to you.

**Browser fingerprinting.** Containers do not change your fingerprint. Firefox's own
fingerprint resistance or the Tor Browser handle that.

**Anything you hand over yourself.** Whatever you do while signed into Google is visible to Google.

**Google code embedded in other sites.** Analytics and reCAPTCHA still load where sites include
them. They simply cannot read the Google container's cookies. Pair this with uBlock Origin or
Firefox's tracking protection if you want them blocked outright.

**Other extensions** with broader permissions than this one.

**A compromised computer or browser.**

## How the code is kept safe

**No network activity.** The extension never contacts any server. The address list is compiled in
when it is built.

**No remote code.** Nothing is evaluated at runtime, and nothing is loaded from anywhere.

**No content scripts.** Nothing is injected into pages and no page content is read.

**No third party code ships.** The extension has no runtime dependencies at all, which keeps the
supply chain minimal. Development tools never reach users.

**Minimal permissions.** Seven of them, each explained in
[docs/PERMISSIONS.md](docs/PERMISSIONS.md), and the build fails if an undocumented one appears.

**Everything untrusted is validated.** Settings read from storage or loaded from a file are rebuilt
field by field. Unknown keys dropped, types checked, lists capped at 2000 entries, and every address
pattern checked against a strict format.

**Addresses are parsed, not pattern matched.** Decisions use the hostname as the browser parses it,
so `https://google.com.example.net/`, `https://example.com/?u=google.com` and
`https://www.google.com@example.com/` are all correctly treated as unrelated. Each has a test.

**No browsing data in logs.** Diagnostics contain counts, versions and error text, never addresses
or history.

**Counters stay local** and can be switched off.

## Automated scanning

Every push, pull request and weekly schedule runs established scanners rather than home made checks.
Findings appear in the repository's Security tab with line level detail.

| Tool                                                 | From          | Looks for                                                 |
| ---------------------------------------------------- | ------------- | --------------------------------------------------------- |
| [CodeQL](https://codeql.github.com/)                 | GitHub        | Injection, unsafe page handling, data flow problems       |
| [Trivy](https://trivy.dev/)                          | Aqua Security | Known vulnerabilities, embedded secrets, misconfiguration |
| [Gitleaks](https://gitleaks.io/)                     | Gitleaks      | Credentials anywhere in the project history               |
| [OSV Scanner](https://google.github.io/osv-scanner/) | Google        | Known vulnerabilities across ecosystems                   |
| [Zizmor](https://docs.zizmor.sh/)                    | zizmorcore    | Weaknesses in the build workflows themselves              |
| npm audit                                            | npm           | Advisory database, split into blocking and advisory runs  |

Two project rules are enforced as build failures:

Production dependencies must have zero advisories. The extension ships no runtime dependencies, so
any finding there means something reached users.

The runtime dependency count must stay at zero. Adding one widens the supply chain and complicates
review, so it fails the build rather than passing quietly.

Gitleaks runs with [custom rules](.gitleaks.toml) covering the credential formats this project
handles. Those rules are checked against deliberately planted test credentials, so a clean result
means something.

The build workflows are hardened as well. Every external action is pinned to an exact revision
rather than a moveable label, checkout does not leave credentials on disk, and dependency updates
wait seven days before being offered, by which time a compromised release has usually been pulled.

## Known limits

**Private windows are left alone by default.** Firefox cannot move a tab between a private window
and a container, so this is opt in and behaves differently there.

**You will see one reload.** Moving a page into the container means stopping the load and starting
it again. That is inherent to the approach and is what guarantees nothing is sent from the wrong
compartment.

**Sign-in pass-through is a trade off.** Letting third party sign-in finish outside the container
keeps those sites working. Turn it off in settings for stricter separation.

**Embedded content is not moved.** Only whole page loads are. Google resources embedded in another
page load in that page's context, which is what makes the web work, and Firefox partitions them
separately anyway.

## Checking a build

Builds are reproducible. Running `npm ci && npm run package` on a given release produces an
identical file, since timestamps inside the archive are fixed. You can compare that against the
released download, or read the built output directly. A development build is not minified:

```bash
NODE_ENV=development npm run build:js
```
