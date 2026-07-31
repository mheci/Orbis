# Installing Orbis

## Requirements

Firefox 140+ desktop. Check Help → About Firefox. Android not supported (no containers). Ensure `privacy.userContext.enabled` true in `about:config`.

## Signed Release (Recommended)

Signed XPI installs permanently on regular Firefox.

1. Go to [latest release](https://github.com/mheci/Orbis/releases/latest)
2. Download `.xpi` file
3. Open `about:addons` → Gear → Install Add-on From File → Select XPI → Approve

Permissions explained in [PERMISSIONS.md](docs/PERMISSIONS.md). File is unlisted, won't auto-update – watch releases.

## Temporary (Try Without Installing)

1. Download `.zip` from latest release
2. Open `about:debugging#/runtime/this-firefox`
3. Load Temporary Add-on → Select ZIP (no unpack)

Disappears when Firefox closes.

## Build From Source

```bash
git clone https://github.com/mheci/Orbis.git
cd Orbis
npm ci
npm run build   # dist/
npm run package # web-ext-artifacts/*.zip
```

Node 20+ required.

### Sign Your Own

Unsigned can't install permanently on release Firefox. Get free API creds from [Mozilla dev hub](https://addons.mozilla.org/developers/addon/api/key/).

```bash
npm run build
npx web-ext sign --source-dir=dist \
  --api-key="YOUR_JWT_ISSUER" \
  --api-secret="YOUR_JWT_SECRET" \
  --channel=unlisted
# Signed XPI in web-ext-artifacts/
```

Keep creds private, never commit.

## Verify Download

Reproducible builds – same source → identical file:

```bash
git clone https://github.com/mheci/Orbis.git
cd Orbis
npm ci
npm run package
sha256sum web-ext-artifacts/orbis-2.0.0.zip
```

Compare with published checksum.

## First Run

No setup needed – defaults are recommended.

Visit google.com → tab reloads once with coloured stripe (container). That's normal, happens once because page moves into Orbis orbit.

Toolbar icon shows status, blocked count. Right-click link → Open in Orbis, or use hotkeys `Ctrl+Shift+O` (new Orbis tab) / `Ctrl+Shift+G` (Google in Orbis).

On first install, onboarding overlay appears (4 steps, theme-matched).

## Removing

`about:addons` → Orbis → Remove. Container itself stays with cookies so you stay signed in and reinstall picks up. To clear cookies: Settings → Privacy and Security → Cookies and Site Data.

## Troubleshooting

- **Nothing contained:** Toolbar badge shows “off” if paused/disabled. Check containers enabled in about:config.
- **Google site missed:** Settings → Diagnostics → URL tester – shows which rule matched. Open issue with address.
- **Non-Google in container:** Check always list, report if unexpected.
- **Sign-in with Google broken:** Ensure oauth passthrough enabled in settings, or add site to never list as workaround.
- **Tabs flicker:** One reload per Google page expected (move into container). Repeated flicker = bug.
- **Settings not saving:** Diagnostics shows storage availability and recent errors.

## Dev

```sh
npm run watch          # rebuild on edit
npm test
npm run lint
npm run typecheck
npm run ci             # full CI
npx web-ext run --source-dir=dist  # throwaway profile with auto-reload
```
