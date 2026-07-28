# The address database

Which addresses belong to Google is stored as data, not code. Everything lives in `src/domains/` as
JSON and is compiled into the extension when it is built, so there is no list fetched at runtime and
no network access.

Adding an address is a one line change plus a test.

## The files

| File            | Contents                                                        |
| --------------- | --------------------------------------------------------------- |
| `google.json`   | Core Google services and .google brand addresses                |
| `youtube.json`  | YouTube, video servers, localised YouTube addresses             |
| `ccTLD.json`    | Country endings, brand endings, and the names they combine with |
| `aliases.json`  | Redirect links, built in exceptions, sign-in paths              |
| `trackers.json` | Advertising and measurement, off by default                     |
| `hosting.json`  | App hosting, off by default                                     |
| `schema.json`   | Structure definition for all of the above                       |

## Rules to understand first

**Subdomains are automatic.** Listing `google.com` also covers `mail.google.com` and
`a.b.c.google.com`. Never write `*.google.com`; the validator rejects wildcards.

**Plain addresses only.** No scheme, no path, no port, no trailing dot, lower case. Anything else
fails the build.

**Brand endings cover the future.** The `brandTLDs` list in `ccTLD.json` holds endings Google owns
outright, such as google, youtube, chrome and android. Any address ending in one of those matches
automatically, so a brand new `something.google` service needs no change at all. The entries listed
individually in `google.json` are belt and braces.

**Country addresses are generated, not listed.** `ccTLD.json` holds base names such as google and
youtube, plus roughly 194 country endings. The loader combines them, so adding one country covers
every product at once. Never paste 194 lines of `google.<ending>` into a file by hand.

## Adding an address

1. **Check Google actually owns it.** Look at WHOIS records, or confirm it is linked from an
   official Google page. Put your evidence in the pull request.
2. **Pick the right file.**
   - A user facing Google service goes in `google.json` under `domains`
   - Anything YouTube goes in `youtube.json`
   - A new country ending goes in `ccTLD.json` under `suffixes`, covering all products at once
   - Advertising or measurement goes in `trackers.json`, staying off by default
   - Anything hosting other people's apps goes in `hosting.json`, staying off by default
3. **Add the entry** in roughly alphabetical position, lower case, plain address.
4. **Update the `updated` date** in that file.
5. **Add a test** in `test/matcher.test.ts` proving the new address is matched.
6. **Run the checks.**
   ```bash
   npm run verify
   npm test
   ```
7. Open a pull request titled `feat(domains): add <address>`.

## On by default, or off

This is the judgement call that matters most, because getting it wrong breaks unrelated websites.

Turn something on by default only when all three are true:

- It is unmistakably a Google product
- People navigate to it directly, on purpose
- Putting it in the container cannot break a site that is not Google

Leave it off when any of these apply:

- It serves other people's content, such as appspot.com or web.app, where the actual site has
  nothing to do with Google
- People usually arrive there in passing rather than deliberately, such as an advertising redirect
  on the way to a shop
- Other sites embed it as a widget, such as the Google sign-in button

When unsure, ship it off by default. A missed address is a gap the user can close with one click. A
wrongly included one is a broken website they have no way to diagnose.

## Inside aliases.json

**redirectors** lists addresses whose query parameters carry a real destination, such as
`google.com/url?q=`. When a page inside the container passes through one of these on the way
somewhere that is not Google, the destination opens outside the container. Parameters are tried in
order and the first proper web address wins.

**neverContainerize** lists sign-in widgets that other websites embed. These only ever load as part
of another site's flow, so putting them in the container breaks that site.

**oauthPaths** lists the address paths that mean a sign-in handshake is underway. Combined with
knowing the page was opened by a non-Google tab, this is what keeps "Sign in with Google" working.

## Validation

`npm run verify` fails the build on:

- Broken JSON, or a missing name, title or date
- A date not written as YYYY-MM-DD
- Capital letters, stray spaces, wildcards, schemes or slashes
- Anything that is not a valid address
- Duplicate entries in a list
- A base name in `ccTLD.json` containing a dot

The tests additionally check that the built database has no duplicates, is entirely lower case, and
is above a minimum size, so silent data loss is caught as well.

## Keeping it current

Google adds and retires services regularly.

**Every few months**, look over [Google's product list](https://about.google/products/) for anything
new.

**When someone reports it**, which is the main signal in practice. A user saying a site was missed
is the most useful report this project gets. The URL tester in the settings page tells you exactly
which rule matched, if any.

**Do not remove retired addresses.** Old links stay in circulation for years, and a dead entry costs
nothing at runtime.
