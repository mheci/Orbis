# Installation

## Requirements

- **Firefox 140 or newer** (Desktop). Containers are a Firefox feature; Chrome is not supported.
  Firefox for Android is not supported — it has no container support.
- Node.js 20+ and npm, if you are building from source.

Container support must be enabled — it is on by default. If containers are unavailable,
`about:config` → `privacy.userContext.enabled` should be `true`.

## Option 1 — Mozilla Add-ons (recommended, once published)

The AMO listing will appear at `https://addons.mozilla.org/firefox/addon/g-container/`.
Until then, use one of the options below.

## Option 2 — Temporary install (quickest, for testing)

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm install
npm run build
```

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist/manifest.json`.

The add-on is removed when Firefox closes. Ideal for development and evaluation.

## Option 3 — Permanent install of an unsigned build

Firefox Release and Beta only install **signed** add-ons. For a permanent unsigned install you need
[Firefox Developer Edition](https://www.mozilla.org/firefox/developer/),
[Nightly](https://www.mozilla.org/firefox/channel/desktop/#nightly), or ESR:

1. Open `about:config`, set `xpinstall.signatures.required` to `false`.
2. Build and package:
   ```bash
   npm run package     # → web-ext-artifacts/g_container-<version>.zip
   ```
3. Open `about:addons` → gear icon → **Install Add-on From File…** → select the `.zip`.

## Option 4 — Self-signing for your own use

Signing produces an `.xpi` that installs permanently on any Firefox channel. You need free
[AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/).

```bash
npm run build
npx web-ext sign --source-dir=dist \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET" \
  --channel=unlisted
```

The signed `.xpi` lands in `web-ext-artifacts/`. Install it via `about:addons` →
**Install Add-on From File…**.

## First run

1. A container named **Google** is created automatically on the first Google navigation.
2. Visit `google.com` — the tab should re-open with the container's colour stripe.
3. Click the toolbar icon to see the current status and statistics.
4. Open Options (popup → ⚙) to rename the container, adjust domain sets or add rules.

Nothing needs to be configured; the defaults are the recommended setup.

## Development workflow

```bash
npm run watch          # incremental rebuilds into dist/
npx web-ext run --source-dir=dist --browser-console
```

`web-ext run` launches a throwaway profile with the add-on loaded and reloads it on rebuild.

Other useful commands:

```bash
npm test               # unit + integration tests
npm run lint           # eslint + prettier check
npm run lint:fix       # auto-fix
npm run typecheck      # strict tsc, no emit
npm run verify         # manifest + domain JSON validation
npm run ci             # everything CI runs
```

## Upgrading

Settings and the container survive upgrades. `migrateSettings()` handles schema changes, and the
container is re-adopted by name even if its internal id changed.

Building a newer version over an older `dist/` is safe — `npm run build` cleans first.

## Uninstalling

`about:addons` → G-Container → **Remove**.

The **Google container is not deleted**, and neither are its cookies. To remove them too, go to
Firefox Settings → _Privacy & Security_ → _Cookies and Site Data_, or delete the container from the
container settings page. Keeping the container means reinstalling later restores your Google
session exactly as it was.

## Troubleshooting

| Symptom                               | Fix                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Nothing is contained                  | Check the badge — `off` means paused/disabled. Verify `privacy.userContext.enabled` is `true`.                          |
| A Google site is not contained        | Options → Diagnostics → _Test a URL_. It names the matching rule, or `none`. Check your never-list, then open an issue. |
| A non-Google site is contained        | Check your always-list. If a built-in rule caused it, open an issue with the URL.                                       |
| "Sign in with Google" fails on a site | Options → General → ensure _OAuth pass-through_ is on; add the site to the never-list as a workaround.                  |
| Tabs flicker on Google links          | Expected once per navigation: the load is cancelled and re-opened in the container. It should never repeat.             |
| Settings will not save                | Options → Diagnostics shows storage availability and recent errors.                                                     |
