# Permissions

Every permission G-Container requests is listed here with the specific feature that needs it and
what would break without it. `scripts/verify-manifest.mjs` fails the build if the manifest declares
a permission that is not documented in this file, so this document cannot silently drift.

## Requested permissions

### `contextualIdentities`

**Needed for:** creating, finding, renaming and recolouring the Google container.
**Used in:** `src/core/container.ts`.
**Without it:** the extension cannot exist — there would be no container to isolate into.

### `cookies`

**Needed for:** Firefox requires the `cookies` permission before an extension may reference
container cookie stores (`cookieStoreId`) in `tabs.create` and `tabs.query`.
**Used in:** implicitly, everywhere a `cookieStoreId` is passed.
**Note:** G-Container never calls `browser.cookies.get`, `.set` or `.remove`. It does not read,
write or delete a single cookie; it only names the jar a tab should use.

### `storage`

**Needed for:** persisting your settings, rules and local counters.
**Used in:** `src/core/storage.ts`.
**Without it:** every setting would reset on each browser restart.

### `tabs`

**Needed for:** reading a tab's URL, cookie store, index, window and opener so a navigation can be
re-opened in the correct container at the same position, and for the "move this tab" commands.
**Used in:** `src/background/index.ts`.
**Without it:** the extension could not tell whether a tab is already in the container, and would
containerize the same page endlessly.

### `menus`

**Needed for:** the right-click entries — _Open link in Google Container_, _Always/Never open this
site in Google Container_, _Move this tab in/out_.
**Used in:** `registerContextMenus()` in `src/background/index.ts`.
**Without it:** only the popup and options page would be available.

### `webRequest` and `webRequestBlocking`

**Needed for:** intercepting top-level (`main_frame`) navigations **before the request is sent**, so
the load can be cancelled and re-issued in the right cookie jar.
**Used in:** `onBeforeRequest` in `src/background/index.ts`.
**Why blocking is unavoidable:** if we let the request go out and redirected afterwards, the
request would already have carried cookies from the wrong jar — exactly the leak the extension
exists to prevent. `declarativeNetRequest` cannot express "does this tab's cookie store match the
Google container?", because that is dynamic per-tab state, so DNR is not a viable substitute.
Firefox continues to support blocking `webRequest` under Manifest V3 for privacy extensions.
**Scope:** the listener is registered with `types: ['main_frame']` only. Sub-resources, XHR, images
and scripts are never inspected.

### `<all_urls>` host permission (`http://*/*`, `https://*/*`)

**Needed for:** a link to Google can be followed from _any_ website, so navigations must be
observed everywhere. The same applies in reverse: to release a non-Google page out of the
container, the extension must see that navigation too.
**What is actually accessed:** the **URL string only**, inside the `onBeforeRequest` listener.
G-Container injects **no content scripts**, reads **no page content or DOM**, and has no
`content_scripts` entry in its manifest.
**Why not a narrower list:** restricting host permissions to Google domains would make it
impossible to detect a non-Google page loading _inside_ the container, breaking the release
behaviour and letting non-Google cookies accumulate in the Google jar.

## Permissions deliberately NOT requested

| Not requested                | Why we do without it                                    |
| ---------------------------- | ------------------------------------------------------- |
| `<all_urls>` content scripts | No page content is ever needed. Nothing is injected.    |
| `history`                    | The extension never reads or edits browsing history.    |
| `bookmarks`                  | Not needed; bookmark clicks are ordinary navigations.   |
| `downloads`                  | Backup export uses an in-page `Blob` + `<a download>`.  |
| `privacy`                    | The extension does not change global browser settings.  |
| `proxy`                      | No network interception beyond navigation decisions.    |
| `identity`                   | No accounts, no sign-in, no remote service.             |
| `nativeMessaging`            | No native components.                                   |
| `management`                 | Other add-ons are none of our business.                 |
| `clipboardRead/Write`        | Not needed.                                             |
| `alarms`                     | The pause feature uses a stored timestamp, not a timer. |
| `notifications`              | The extension is silent by design.                      |

## Data handling

- **No network requests.** G-Container never contacts any server, including the author's. The domain
  database is compiled into the add-on.
- **No telemetry, analytics or crash reporting.**
- **No remote code.** Nothing is `eval`'d or loaded at runtime; the CSP-relevant surface is empty.
- **Local data only.** Settings and counters live in `storage.local`. If you opt into Firefox Sync,
  they additionally travel through _your_ Mozilla-encrypted Sync account and nowhere else.
- **Statistics** are four integers plus two timestamps, and can be turned off in Options.
