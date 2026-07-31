# Permissions

Firefox shows a list of permissions when you install an extension. This page explains what each one
is for in Orbis, and what would stop working without it.

The build fails automatically if a permission is added without being documented here, so this page
cannot quietly fall out of date.

## What is requested

### contextualIdentities

Creates and manages the Google container itself, including its name, colour and icon.

Without it there would be no container to separate anything into, so the extension could not
function at all.

### cookies

Firefox requires this before an extension is allowed to refer to a container's cookie storage when
opening a tab.

Worth being precise here: the extension never reads, writes or deletes a single cookie. It has no
code that touches cookie contents. This permission only lets it name which compartment a tab should
use.

### storage

Saves your settings and rules so they survive restarting the browser. Also used for the optional
Firefox Sync mirroring.

Without it every setting would reset each time you closed Firefox.

### tabs

Reads a tab's address, which container it is in, its position and which tab opened it. That
information is needed to reopen a page in the right container, in the same position, and to power
the "move this tab" buttons.

Without it the extension could not tell whether a tab was already in the container, and would keep
moving the same page forever.

### menus

Adds the right click options: open a link in the Google container, always or never use the
container for a site, and move the current tab in or out.

Without it only the popup and settings page would be available.

### webRequest and webRequestBlocking

Lets the extension see a page load starting and stop it before the request is sent, so the page can
be reopened in the correct container.

Stopping the request first is the whole point. If the page were allowed to load and then moved
afterwards, cookies from the wrong compartment would already have been sent, which is exactly the
leak the extension exists to prevent.

There is a newer permission called declarativeNetRequest that some extensions use instead. It
cannot work here, because the decision depends on which container the current tab is already in,
and that is live information the newer system has no way to consult.

Two listeners are registered. One watches top level page loads and decides which container they
belong in. The other watches scripts, images, frames and background requests, and cancels the ones
identified as Google tracking on websites that are not Google.

The second listener reads the address of the resource and the address of the page requesting it.
That is all it needs, and all it uses.

### Access to all websites

A link to Google can be clicked from any site, so page loads have to be observed everywhere. The
same applies in reverse: spotting a non-Google page opened inside the container requires seeing
that load too.

What is actually accessed is the address, and nothing else. The extension injects no code into
pages and reads no page content. There is no content script in the manifest at all.

Restricting this to Google addresses only would break the ability to move non-Google pages back out
of the container, which would let unrelated cookies build up inside it.

## What is deliberately not requested

| Not requested   | Why it is not needed                                         |
| --------------- | ------------------------------------------------------------ |
| Content scripts | No page content is ever read, and nothing is injected        |
| history         | Browsing history is never read or changed                    |
| bookmarks       | Clicking a bookmark is an ordinary page load                 |
| downloads       | Exporting settings uses an in page link instead              |
| privacy         | No global browser settings are changed                       |
| proxy           | No network traffic is intercepted beyond page load decisions |
| identity        | There are no accounts and no remote service                  |
| nativeMessaging | There is no companion program                                |
| management      | Other extensions are none of its business                    |
| clipboard       | Not needed                                                   |
| alarms          | Pausing uses a stored timestamp rather than a timer          |
| notifications   | The extension stays quiet                                    |

## What happens to your data

No network requests are made. Not to Google, not to the author, not to anyone. The list of Google
addresses is compiled into the extension when it is built.

No telemetry, no analytics, no crash reporting, and no third party code.

Settings and counters live on your own machine. Turning on the Sync option additionally sends them
through your own Mozilla account, encrypted, and nowhere else.

The usage counters are four numbers and two dates. They can be switched off in the settings.
