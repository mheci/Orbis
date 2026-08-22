# Roadmap

Ordered by how much difference something makes to users, not by how interesting it is to build.
Anything that adds moving parts has to earn its place, because being dependable is the point.

## Done, version 2.3

- **Automatic updates for self-hosted installs.** The manifest now points Firefox at an update
  manifest on GitHub Pages; the Release workflow regenerates it from the live release list with
  per-release checksum pins. Installs from before v2.3.0 need one manual reinstall to join.
- **Temporary allowances.** Pause containment for the current site for half an hour from the
  popup; containment resumes on its own, a countdown shows on the toolbar icon, and nothing
  can forget to re-enable it because expiry is enforced by the clock, not a timer.
- **Activity by site.** The aggregate counters gained a local per-host breakdown (contained,
  released, unwrapped, trackers blocked) in Backup & data — hostnames only, capped at 200
  sites, never synced or exported.

## Done, version 2.0

- Rebrand from G-Container to Orbis, with the extension id pinned to `orbis@mheci.github.io`
- Four-step onboarding page on first install
- Keyboard commands for opening an Orbis tab, Google in Orbis, and the popup
- Subresource blocking (from 1.1): Google analytics, advertising and social widgets are
  cancelled before they leave the machine, in standard and strict modes
- Deterministic, reproducible builds with a CI gate that proves two clean builds are identical
- Security scanning: CodeQL, Trivy, Gitleaks, OSV Scanner, Zizmor, npm audit, dependency review
- GitHub-only distribution: releases are signed by Mozilla's signing service
  (`--channel=unlisted`) but never submitted or published to addons.mozilla.org
- Release artifacts: signed XPI (signature verified), unsigned ZIP, source archives, checksums

## Next

Polish and reach.

- **Translations.** Move every visible string into message files so the extension can be
  translated.
- **Better exceptions screen.** The data already stores notes, an enabled flag and a date for
  each exception, but the settings page only shows a flat list.
- **Keyboard shortcuts** for moving a tab in or out and for pausing.
- **Accessibility review** covering keyboard navigation, screen readers and colour contrast.

## After that, version 1.2

Better answers when something looks wrong.

- **A record of recent decisions** in diagnostics, showing what happened and why. Kept in memory
  only, never saved, and off unless switched on, since it amounts to browsing history.
- **Bulk editing** of the always and never lists, so a list can be pasted in rather than typed one
  line at a time.
- **Importing rules** from similar tools for people switching over.

## Later, version 1.3

Separate work and personal Google containers, with their own rules. Requested often, and deliberately
scheduled late because it multiplies everything the extension has to keep track of. Existing users
would see no change unless they opt in.

## Someday, version 2.0

The same engine handling other companies, with the address list as the only thing that differs.

Community maintained address lists, but only if there is a design that keeps the promise of making
no network requests. Shipping updated lists inside extension updates is the obvious route.

## Not planned

Listed so nobody spends time proposing them.

**Content or ad blocking.** Use uBlock Origin. Separating and blocking are different jobs and doing
both badly is worse than doing one well.

**Any telemetry**, even anonymous and opt in.

**Publishing on addons.mozilla.org.** Orbis is distributed exclusively through GitHub Releases.
Artifacts are signed by Mozilla's signing service so they install on release Firefox, but the
add-on is never submitted to the store; a store listing would add a review surface without
benefit for the people it would serve.

**Remote configuration or remotely loaded code**, in any form.

**Chrome or Edge support.** Containers are a Firefox feature. There is nothing to port to.

**A rule language with patterns and logic.** Addresses and path prefixes cover real needs. A small
programming language in the settings would be a foot gun and a security surface.

**Automatic Google account switching.** Out of scope and fragile.

## Maintenance commitments

- Review the address list against Google's product pages every few months
- Confirm compatibility with each new long term Firefox release
- Triage security reports within 72 hours, as described in [SECURITY.md](../SECURITY.md)
- Keep dependencies current through automated updates, with runtime dependencies staying at zero

## Influencing this

Open a [discussion](https://github.com/mheci/Orbis/discussions) for ideas or an
[issue](https://github.com/mheci/Orbis/issues) for concrete problems. Reports of missed
or wrongly caught sites are the most useful and are usually fixed within days.
