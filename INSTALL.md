# Installing Orbis

## Before you start

You need Firefox 140 or newer on desktop. Check with Help, then About Firefox.

Firefox for Android is not supported. It has no container feature, so there is nothing for the
extension to use.

Containers are switched on in Firefox by default. If they have been disabled, open `about:config`
and set `privacy.userContext.enabled` to true.

## Recommended: install the signed file

Every release includes a file signed by Mozilla, which installs permanently on any version of
Firefox including the standard release.

1. Go to the [latest release](https://github.com/mheci/Orbis/releases/latest).
2. Download the file ending in `.xpi`.
3. Open `about:addons` in Firefox.
4. Click the gear icon near the top right, then choose "Install Add-on From File".
5. Pick the file you downloaded and confirm.

Firefox shows you the list of permissions before installing. Every one of them is explained in
[docs/PERMISSIONS.md](docs/PERMISSIONS.md).

One thing to know: the file is signed for direct distribution rather than listed in Mozilla's
public add-on directory, so it will not update itself. Watch the repository releases page for new
versions.

## Trying it temporarily

If you just want a look without installing anything permanently, this takes about a minute and
disappears when you close Firefox.

1. Download the `.zip` from the [latest release](https://github.com/mheci/Orbis/releases/latest).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on".
4. Select the `.zip`. There is no need to unpack it.

## Building it yourself

```bash
git clone https://github.com/mheci/Orbis.git
cd orbis
npm install
npm run build
```

The finished extension appears in `dist/`. Load it through `about:debugging` as described above, or
package it into a `.zip` with `npm run package`.

Node.js 20 or newer is required to build.

### Signing your own build

An unsigned build cannot be installed permanently on standard Firefox. To sign one yourself you
need free API credentials from
[the Mozilla developer hub](https://addons.mozilla.org/developers/addon/api/key/).

```bash
npm run build
npx web-ext sign --source-dir=dist \
  --api-key="YOUR_JWT_ISSUER" \
  --api-secret="YOUR_JWT_SECRET" \
  --channel=unlisted
```

The signed file lands in `web-ext-artifacts/`. Install it through `about:addons` as above.

Keep those credentials private. Never commit them.

## Checking the download is genuine

Builds are reproducible, meaning the same source always produces an identical file. You can rebuild
from source and compare against the released checksum:

```bash
git clone https://github.com/mheci/Orbis.git
cd orbis
npm ci
npm run package
sha256sum web-ext-artifacts/g_container-1.1.0.zip
```

If the checksums match, the released file was built from the source you just read.

## First run

Nothing needs setting up. The defaults are the recommended configuration.

Visit google.com. The tab reloads once and comes back with a coloured stripe along the top, which
is how Firefox shows that a tab is in a container. That single reload is normal and happens because
the page is being moved; it should not repeat.

Click the toolbar icon to see the current status.

## Removing it

Open `about:addons`, find Orbis and choose Remove.

The Google container itself stays, along with its cookies, so you remain signed in. If you want to
clear those too, go to Firefox Settings, then Privacy and Security, then Cookies and Site Data.
Leaving the container in place means reinstalling later picks up exactly where you left off.

## If something is wrong

**Nothing is being put in a container.** Check the toolbar icon. A badge reading "off" means
protection is paused or disabled. Also confirm containers are enabled, as described at the top of
this page.

**A Google site is not being caught.** Open the settings page, go to Diagnostics, and paste the
address into the URL tester. It tells you which rule matched, or that none did. If none did, please
[open an issue](https://github.com/mheci/Orbis/issues) with that address.

**A site that is not Google is being put in the container.** Check whether you added it to the
always list. If not, please report it with the address.

**A "Sign in with Google" button is not working.** Open the settings page and confirm the sign-in
pass-through option is enabled. As a workaround, add the site to the never list.

**Tabs flicker when opening Google links.** One reload per page is expected, since the page is
being moved into the container. Repeated flickering is a bug worth reporting.

**Settings are not saving.** The Diagnostics section of the settings page reports whether storage is
available and lists recent errors.

## Development

```bash
npm run watch          # rebuild automatically while editing
npm test               # run the test suite
npm run lint           # check formatting and code style
npm run typecheck      # check types
npm run ci             # everything the build server runs
```

To run a throwaway Firefox profile with the extension loaded and reloading on each change:

```bash
npx web-ext run --source-dir=dist
```
