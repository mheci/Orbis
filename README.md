# Orbis

**Keep Google in its own orbit.** One container, zero tracking, feels native.

Orbis is a Firefox extension that automatically puts every Google site in a separate container – an isolated orbit where Google's cookies stay locked. Other sites can't see your Google session, and Google can't see your other browsing.

## For Novices

**What it does:** Separates Google (Search, YouTube, Gmail, Maps, etc.) into its own private box. You stay signed in and Google works normally, but its cookies can't follow you to other sites.

**How it functions:**
1. You open any Google site (from anywhere) – Orbis stops it and reopens in container named **Orbis**
2. Everything else browses normally outside that container
3. Google trackers on other sites (Analytics, DoubleClick) are blocked before they leave your machine
4. Fonts, maps, videos, reCAPTCHA, Sign-in with Google are left alone to avoid breaking pages

**How it behaves:**
- Automatic: No clicks needed, just browse. Link to Google lands in orbit on its own.
- Isolated: Each orbit has its own cookie jar, storage, cache.
- Protective: Blocks Google tracking code on other sites (standard: analytics/ads/social, strict: + fonts/maps/embeds)
- Invisible: Non-persistent background, no polling, no network, no telemetry – runs entirely on your device
- Fast: Hotkeys and right-click menus feel native

First install shows a friendly 4-step intro overlay, theme-matched to your browser (light/dark), explaining everything in plain language.

## Install

Firefox 140+ desktop required.

1. Download latest `-signed.xpi` from [Releases](https://github.com/mheci/Orbis/releases/latest)
2. Open `about:addons` → Gear → Install Add-on From File → Select XPI → Approve

## Use

**Keyboard (fastest, invisible):**
- `Ctrl+Shift+O` – New Orbis tab (Google in its orbit)
- `Ctrl+Shift+G` – Open Google in Orbis
- `Alt+Shift+O` – Open Orbis popup

Change shortcuts: Add-ons Manager → Gear → Manage Extension Shortcuts

**Mouse:**
- Toolbar button → See if current page is protected, blocked count, move tab in/out, pause
- Right-click link → Open link in Orbis / Always open this site in Orbis / Never
- Right-click page → Move tab into/out of Orbis

**Automatic cleanup:** Non-Google pages opened inside Orbis are moved back out, so orbit only ever holds Google activity. Redirect links unwrapped to real destination outside.

## What Counts as Google

Orbis knows 952+ addresses via JSON data:

- **Google services** (713, on by default): Search, Gmail, Drive, Maps, YouTube (213), etc. – includes all country versions (google.co.uk) and brands (Fitbit, Nest, Waze, Kaggle, Tenor). Any `*.google` or `*.youtube` auto-recognized.
- **Advertising** (16, off by default): DoubleClick, Analytics, Tag Manager – off because ad click-throughs breaking destination.
- **App hosting** (10, off): appspot.com, web.app, firebaseapp.com – hosts others' apps.

Adding a missing site is one line in `src/domains/*.json` – see [DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md).

## Privacy

- No network requests of its own – list built into file you install
- No telemetry, analytics, crash reporting, third-party code
- Only reads URLs to decide containment, never page content, injects nothing
- Counters kept locally, optional, clearable
- Permissions explained in [PERMISSIONS.md](docs/PERMISSIONS.md)

## What It Doesn't Do (Honest Limits)

- Not a general ad blocker – only Google, use uBlock Origin alongside for broad blocking
- IP address unchanged when visiting Google directly, fingerprint not hidden
- Can't guarantee erasure of HTTP cache, history, passwords – those aren't container-scoped (Firefox limitation)
- Browser-exit cleanup runs on next startup (extensions can't block shutdown)

## Development

```sh
git clone https://github.com/mheci/Orbis.git
cd Orbis
npm ci
npm run check   # format, lint, typecheck, secrets, test, build verify
npm run build
npm run package # web-ext-artifacts/*.zip
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md), [TESTING.md](docs/TESTING.md).

## License

[MPL-2.0](LICENSE)
