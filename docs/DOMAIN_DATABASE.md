# The domain database

Which hosts belong to Google is **data, not code**. Everything lives in `src/domains/*.json` and is
inlined into the bundle at build time — there is no runtime fetch, no remote list and no network
access. Adding a domain is a one-line JSON change plus a test run.

## Files

| File            | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `google.json`   | Core Google properties and hosts under the `.google` brand gTLD      |
| `youtube.json`  | YouTube, video CDNs, localized YouTube domains                       |
| `ccTLD.json`    | Country suffixes, brand gTLD labels, and the base labels they expand |
| `aliases.json`  | Redirector rules, built-in never list, OAuth paths                   |
| `trackers.json` | Advertising/measurement domains (**opt-in**)                         |
| `hosting.json`  | User-content hosting domains (**opt-in**)                            |
| `schema.json`   | JSON Schema describing all of the above                              |

## Matching rules you must understand

**Subdomains are implicit.** Listing `google.com` matches `google.com`, `mail.google.com` and
`a.b.c.google.com`. Never write `*.google.com` — the validator rejects wildcards.

**Only bare hosts.** No scheme, no path, no port, no trailing dot, lower-case only. CI rejects
anything else.

**Brand gTLDs cover the future.** `ccTLD.json` → `brandTLDs` lists ICANN brand TLDs delegated to
Google (`google`, `youtube`, `chrome`, `android`, …). _Any_ host ending in one of those labels
matches automatically, so you do **not** need to add a new `something.google` service by hand.
The entries in `google.json` → `gtldDomains` are documentation and belt-and-braces only.

**ccTLDs are expanded, not listed.** `ccTLD.json` holds `bases` (`google`, `youtube`, `blogspot`,
`gstatic`) and ~180 `suffixes` (`com`, `co.uk`, `com.eg`, …). The loader produces the cartesian
product, so adding one country covers every product at once. Never paste 180 lines of
`google.<tld>` into `google.json`.

## How to add a domain

1. **Confirm Google actually owns it.** Check WHOIS, or that the site is linked from an official
   Google property. Include your evidence in the PR description.
2. **Pick the right file and set:**
   - a user-facing Google service → `google.json` → `domains`
   - anything YouTube → `youtube.json` → `domains`
   - a new country suffix → `ccTLD.json` → `suffixes` (covers all bases at once)
   - an ad/measurement host → `trackers.json` (stays opt-in)
   - a host serving third-party apps → `hosting.json` (stays opt-in)
3. **Add the entry** in the correct alphabetical-ish position, lower-case, bare host.
4. **Bump `updated`** to today's date in that file.
5. **Add a test** in `test/matcher.test.ts` asserting the new host is matched.
6. **Run the checks:**
   ```bash
   npm run verify   # JSON schema + host syntax + duplicate detection
   npm test
   ```
7. Open a PR titled `feat(domains): add <domain>`.

## Choosing between "on by default" and "opt-in"

This is the judgement call that matters most, because a wrong choice breaks unrelated websites.

**Default-on** requires all of:

- the host is unambiguously a Google product surface, and
- users navigate to it at the top level on purpose, and
- containerizing it cannot break a non-Google site.

**Opt-in** if any of:

- the host serves third-party content (`appspot.com`, `web.app`, `firebaseapp.com` host apps that
  have nothing to do with Google), or
- top-level navigations to it are usually pass-throughs belonging to another site
  (`doubleclick.net` ad click-throughs, `googleadservices.com` redirects), or
- it is embedded by other sites as a widget (`accounts.google.com/gsi` — that one is in the
  built-in _never_ list, because containerizing it breaks "Sign in with Google" everywhere).

When in doubt, ship it opt-in. A missed domain is a privacy gap the user can fix with one click; a
false positive is a broken website they cannot diagnose.

## `aliases.json` in detail

### `redirectors`

Hosts whose query parameter carries a real destination:

```json
{ "host": "google.com", "path": "/url", "params": ["q", "url"] }
```

When a **contained** tab navigates through one of these to a **non-Google** destination, the
destination is opened outside the container. Parameters are tried in order; the first absolute
`http(s)` URL wins, and destinations that are themselves Google are left alone.

### `neverContainerize`

`host + path prefix` entries for federated sign-in widgets embedded by third parties. These are only
ever loaded as part of _another_ site's flow, so containerizing them breaks that site.

### `oauthPaths`

Path prefixes on `accounts.google.com` that indicate a third-party OAuth handshake. Combined with
"was this navigation started by a non-Google tab?", they drive the OAuth pass-through behaviour.

## Validation

`npm run verify` runs `scripts/validate-json.mjs`, which fails CI on:

- invalid JSON or a missing `id` / `title` / `updated`
- `updated` not in `YYYY-MM-DD` form
- uppercase entries, surrounding whitespace, wildcards, schemes, slashes
- hosts that are not valid LDH labels
- duplicates within a list
- a `ccTLD.json` base containing a dot
- (warning) fewer than 50 country suffixes

`test/domain-db.test.ts` additionally asserts the built database is duplicate-free, lower-cased,
and above a minimum size, so silent data loss is caught too.

## Maintenance cadence

Google adds and retires services regularly. Suggested routine:

- **Quarterly** — review [about.google/products](https://about.google/products/) for new surfaces.
- **On report** — a user issue saying "site X wasn't contained" is the main signal; the Options →
  Diagnostics → _Test a URL_ tool tells you exactly which rule (if any) matched.
- **Never remove** a retired domain immediately. Old links persist; keeping a dead host costs a few
  bytes in the trie and nothing at runtime.
