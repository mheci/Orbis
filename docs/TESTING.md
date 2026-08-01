# Testing

```bash
npm test              # run everything, 366 tests
npm run test:watch    # rerun as you edit
npm run test:coverage # with coverage limits enforced
npm run ci            # everything the build server runs
```

## Approach

The core is written as plain functions with dependencies passed in, so no browser stand in is
needed. Tests run under Node and the whole suite finishes in about two seconds, which removes any
excuse for skipping them before committing.

| Area              | File                       | Covers                                                                                                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Address matching  | `test/matcher.test.ts`     | Every service category, country addresses, brand endings, lookalikes, schemes, precedence, redirect links, sign-in detection                |
| Decisions         | `test/decision.test.ts`    | Contain, release, unwrap and ignore, pausing, private windows, sign-in pass-through, loop prevention                                        |
| Background worker | `test/background.test.ts`  | The real worker driven against a stand in Firefox: containment, release, failure handling, container recovery, messaging, restart behaviour |
| Settings          | `test/settings.test.ts`    | Defaults, rejecting bad input, merging, migration, backup round trip                                                                        |
| Storage           | `test/storage.test.ts`     | Saving, corruption recovery, sync precedence, simultaneous writes, failing storage                                                          |
| Containers        | `test/container.test.ts`   | Creation, reuse, races, recovery after deletion, renaming, missing API                                                                      |
| Address data      | `test/domain-db.test.ts`   | Expansion correctness, duplicates, formatting, minimum size                                                                                 |
| Performance       | `test/performance.test.ts` | Build time, 50,000 lookups, cache limits, loop guard memory                                                                                 |

Coverage limits are enforced for the core and background code at 80 percent of lines, functions and
statements, and 75 percent of branches. The build fails below that.

The background worker is tested through `test/mock-browser.ts`, a stand in that behaves like real
Firefox. Looking up a missing tab throws, looking up an unknown container throws, and tab creation
can be made to fail on demand. A stand in returning convenient values instead would hide exactly the
bugs this layer is prone to.

## Checks that exist for a reason

Each of these is here because getting it wrong is a privacy failure rather than a cosmetic one.

- `https://google.com.example.net/` is not put in the container
- `https://example.com/?redirect=https://mail.google.com` is not put in the container
- `https://www.google.com@example.com/` is not put in the container
- `javascript:`, `data:`, `file:` and extension addresses are never touched
- An imported settings file containing `javascript:alert(1)` as a rule has it silently dropped
- An oversized import of 5000 rules is capped at 2000
- Twenty rapid page loads bouncing back and forth produce exactly one move
- Twenty five simultaneous container requests create exactly one container
- If a replacement tab cannot be created, the page is allowed through rather than cancelled, so no
  one is left on a blank tab
- Google Fonts, hosted script libraries, reCAPTCHA, sign-in and embedded players keep loading in
  standard mode, each with a note in the test explaining what breaks if they do not
- Sign-in and reCAPTCHA keep loading even in strict mode, so nobody is locked out of an account
- The blocking handler returns synchronously, since returning a promise would slow every request

## Manual checks

Automated tests cannot exercise real Firefox tab handling. Work through this list before tagging a
release, using a fresh profile.

### Basics

- Typing google.com in the address bar opens it in the container
- Clicking a Google search result stays in the container
- Clicking a result that is not Google leaves the container
- Opening youtube.com from an ordinary tab moves it into the container
- A youtu.be short link goes to the container
- A bookmarked Gmail address goes to the container
- Middle clicking and control clicking a Google link works, in the right tab position
- Links opening in a new tab or window go to the container

### Signing in

- Sign into Google in the container, then open google.com in an ordinary tab; it should be
  contained and already signed in
- Sign out; nothing should remain in ordinary browsing
- A "Sign in with Google" button on another site completes and returns you signed in
- An embedded YouTube video on another site still plays

### Awkward cases

- A Google search result linking elsewhere lands outside the container
- A site that bounces through Google and back settles instead of looping
- Deleting the container in Firefox settings, then visiting Google, recreates it
- Renaming the container in settings updates the tab stripe and keeps you signed in
- Private windows do nothing by default, and act once the option is enabled
- Going offline shows a normal error page with no looping
- With fifty tabs open, restarting Firefox restores the session with no duplicates

### Blocking

- Visit a news site and check the toolbar icon shows a count
- Confirm the page still looks right: fonts loaded, layout intact
- Visit a site with an embedded map and confirm the map appears
- Visit a site with a reCAPTCHA box and confirm you can submit the form
- Use a "Sign in with Google" button on a third party site and confirm it completes
- Play an embedded YouTube video on a third party site
- Switch to strict mode and confirm the warning is visible, then check that sign-in and reCAPTCHA
  still work while fonts and maps stop loading
- Use the popup button to allow a site, reload, and confirm the count drops to zero

### Settings

- Adding a never rule for docs.google.com makes it open outside the container
- Adding an always rule for a non-Google site makes it open inside
- Toggling the advertising group changes behaviour immediately
- Pausing shows the off badge and stops containment; resuming restores it
- Exporting, resetting and reimporting restores every setting
- Importing a damaged file shows a clear error and changes nothing
- The URL tester reports the correct matching rule

### Upgrading

- Configure an older build, then install a newer one over it; settings and container survive
- Uninstall and reinstall; the existing container is picked up again and you are still signed in

## Writing tests

A bug fix needs a test that fails before the fix.

A new address needs a matching assertion.

A behaviour change needs `test/decision.test.ts` updated, since that file is the written record of
how the extension is supposed to behave.
