# Roadmap

Ordered by how much difference something makes to users, not by how interesting it is to build.
Anything that adds moving parts has to earn its place, because being dependable is the point.

## Done, version 1.0

- Automatic containment of Google services
- 952 addresses covering country domains and brand endings
- Moving non-Google pages back out of the container
- Following Google redirect links to their real destination
- Keeping third party "Sign in with Google" working
- Loop prevention
- Settings page, popup, right click menu
- Always and never lists
- Backup, restore, reset and optional sync
- Diagnostics with a URL tester
- 292 tests, automated builds, full documentation
- Signed releases

## Next, version 1.1

Polish and reach.

- **Translations.** Move every visible string into message files so the extension can be translated.
- **Better exceptions screen.** The data already stores notes, an enabled flag and a date for each
  exception, but the settings page only shows a flat list.
- **Keyboard shortcuts** for moving a tab in or out and for pausing.
- **A short welcome page** on first install explaining what will change and what will not.
- **Accessibility review** covering keyboard navigation, screen readers and colour contrast.
- **Listing on Mozilla's add-on site**, which needs screenshots, store text and review notes.

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

Open a [discussion](https://github.com/astarling-x/g-container/discussions) for ideas or an
[issue](https://github.com/astarling-x/g-container/issues) for concrete problems. Reports of missed
or wrongly caught sites are the most useful and are usually fixed within days.
