# Architecture

How the code is organised, why it is organised that way, and which rules must not be broken. Worth
reading before changing anything under `src/core/`.

## Principles

**The core is pure.** Every decision the extension makes is computed by functions that take input
and return output, with no side effects and no browser access. Being predictable is what makes the
behaviour testable and keeps timing bugs out.

**Data instead of code.** Which addresses belong to Google is data, held in JSON files. Adding one
must never require editing TypeScript.

**Fail safe, not stuck.** If storage is corrupt, the container was deleted, or an API call throws,
the extension does nothing rather than trapping the user's tabs.

**Ask for as little as possible.** No permission is requested without a specific need, and the
build enforces that each one is documented.

## Layout

```
src/
  manifest.json         Extension manifest, Firefox 140 and up
  types/index.ts        Shared type definitions, no runtime code
  domains/*.json        The address database
  core/
    domain-db.ts        Loads and expands the JSON into memory
    matcher.ts          Decides whether an address belongs to Google
    decision.ts         Works out what to do about a page load
    settings.ts         Defaults, validation, migration, backups
    container.ts        Creating and tracking the container
    storage.ts          Reading and writing saved settings
  background/index.ts   Connects browser events to the core
  popup/                Toolbar popup
  options/              Settings page
```

Dependencies only ever point one way. The background layer uses the core, the core uses the data
files. Nothing in `core/` reaches back the other way or touches the browser directly, which is what
lets the entire core run under plain Node in tests with no browser stand in.

## What happens on a page load

1. Firefox reports a top level page load about to start.
2. The background layer gathers the facts: the address, the tab, which container it is in, which
   tab opened it, and whether it is a private window.
3. Those facts go to `decideNavigation()`, which returns one of four answers.
4. The background layer carries out that answer.

The four answers:

| Answer  | Meaning                                                        |
| ------- | -------------------------------------------------------------- |
| contain | Stop the load, reopen the page inside the container            |
| release | Stop the load, reopen the page outside the container           |
| unwrap  | Follow a Google redirect link to its real destination, outside |
| ignore  | Do nothing, let the page load normally                         |

Stopping the request before it is sent is the critical detail. Loading first and moving afterwards
would mean cookies from the wrong compartment had already gone out.

## Matching addresses

`UrlMatcher` builds a tree of address labels read back to front, so `mail.google.com` is stored as
com, then google, then mail. Looking up an address walks as many steps as it has parts, typically
three to five, no matter whether the database holds 900 entries or 90,000.

This gives a few useful properties:

Subdomains are covered automatically. Listing `google.com` matches `mail.google.com` and
`a.b.c.google.com`, but not `google.com.example.net`, because the walk fails at `example`.

Matching runs on the address as parsed by the browser, never on raw text. That is what makes
`https://example.com/?x=google.com` and `https://www.google.com@example.com/` correctly count as
unrelated.

Brand endings are a single check on the last part of the address, which is why any future
`something.google` service is recognised with no update.

Results are remembered in a cache capped at 512 entries. Bounded memory matters during long
browsing sessions.

The matcher never changes after it is built. Changing a setting builds a new one, taking a couple of
milliseconds, so a decision already in flight can never see half updated rules.

## Order of precedence

Checked from the top down, first match wins:

1. Sites the user marked "never"
2. The user's own exceptions
3. Built in exceptions for sign-in widgets that other sites embed
4. Sites the user marked "always"
5. Brand endings such as .google and .youtube
6. The enabled groups in the address database
7. Anything else browses normally

## Avoiding loops

The classic way this kind of extension fails is a loop. Site A sends you to Google, the extension
moves it, the container sends you back to A, the extension moves it out, and around it goes.

`LoopGuard` remembers which address was acted on in which tab for three seconds and refuses to act
twice on the same pair inside that window. It is capped in size, expires old entries, is tracked per
tab so one looping tab cannot affect another, and is cleared when a tab closes or settings change.

A test simulates twenty rapid page loads bouncing back and forth and confirms exactly one move
happens.

## The container itself

`ContainerManager.ensure()` finds the container in this order:

1. The one already in memory, if it still exists
2. The one saved from a previous session
3. Any existing container with the configured name
4. Create a new one

Step three is what lets a reinstall pick up your existing cookies and stay signed in.

Several page loads racing at startup all wait on a single shared operation, so it is impossible to
end up with two containers. There is a test for that using twenty five simultaneous calls.

Deleting the container in Firefox settings clears the stored reference, and the next page load
quietly recreates it.

## Saved settings

Local storage is the source of truth. Sync is optional, and a synced copy is only adopted when it is
both newer and explicitly marked as coming from a profile with sync enabled, so a stale copy from
another machine cannot silently override a local choice.

Writes are queued one after another so two rapid changes cannot overwrite each other. A failed sync
write never prevents the local write.

Everything read back is rebuilt field by field. Unknown keys are dropped, wrong types are replaced
with defaults, lists are capped at 2000 entries, and every address pattern must pass a strict format
check. Corrupted or hostile input cannot reach the matcher.

## Running without a persistent background page

The background script can be shut down by Firefox at any time, so:

Anything that must survive lives in storage. Anything else, the loop guard and the compiled matcher,
is cheap to rebuild. Setup is safe to call repeatedly and every entry point waits for it.

Counter writes are delayed by five seconds so a burst of page loads does not hammer storage.

## Rules that must hold

Breaking any of these is a bug.

1. A contain action targets the container and nothing else.
2. A replacement tab is always created before the original is closed, so a tab is never lost.
3. If the replacement cannot be created, the original load is allowed through rather than cancelled.
4. `decideNavigation` performs no input or output and stays synchronous.
5. Nothing in `core/` touches the browser directly.
6. Every saved or imported document is validated before use.
7. No code path makes a network request.

## Speed limits

Enforced by the performance tests.

| Operation                                  | Limit                  |
| ------------------------------------------ | ---------------------- |
| Building the matcher, around 950 addresses | under 150 ms           |
| Matching 50,000 distinct addresses         | under 2000 ms          |
| 100,000 repeat lookups from cache          | under 500 ms           |
| Cache size                                 | 512 entries            |
| Loop guard across 50,000 operations        | under 2000 ms, bounded |

## The icon

Generated from source by `scripts/make-icons.py` rather than stored as image files, so it can be
reviewed as a normal change and regenerated at any size.

The mark is a capital G inside a broken ring, the ring standing for the container boundary. Colours
are deliberately not Google's own, since using them on an unaffiliated extension would invite a
trademark complaint.

The G is drawn by cutting shapes out of a filled circle rather than stroking a curve. A stroked
curve closes up into an unreadable blob at 16 pixels. Detail also varies by size: below 20 pixels
the broken ring turns to mush, so small sizes use a solid one.

Regenerate with `python3 scripts/make-icons.py`. Only sizes named in the manifest are packaged.

## Fixed identity

Two values are locked and checked by the build.

| Value        | Setting                             | Why                                                                                                                                                                                                                                                       |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension ID | `g-container@astarling-x.github.io` | Firefox uses this to recognise the add-on. Changing it after release makes Firefox treat an update as a completely different extension, so users get no update and a fresh install would create a new empty container, losing their cookies and settings. |
| Account name | `astarling-x`                       | The project used to live elsewhere. A stale link is a dead end for users, and a dead security reporting link is worse than that.                                                                                                                          |

If the project ever moves accounts again, move the repository and leave the extension ID alone.
