#!/usr/bin/env node
/** Copy manifest, HTML, CSS and icons into dist/. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist/popup', { recursive: true });
await mkdir('dist/options', { recursive: true });
await mkdir('dist/icons', { recursive: true });

// Keep manifest.version in lockstep with package.json — one source of truth.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
manifest.version = pkg.version;
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const files = [
  ['src/popup/popup.html', 'dist/popup/popup.html'],
  ['src/popup/popup.css', 'dist/popup/popup.css'],
  ['src/options/options.html', 'dist/options/options.html'],
  ['src/options/options.css', 'dist/options/options.css'],
];
for (const [from, to] of files) await cp(from, to);
// Copy only the icon sizes the manifest actually references. The 512px master
// is for the AMO listing and README, and shipping it (plus any unused size)
// would be dead weight in every user's profile.
const referencedIcons = new Set(
  [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].map((p) => p.replace(/^icons\//, ''))
);
for (const icon of referencedIcons) {
  await cp(`src/icons/${icon}`, `dist/icons/${icon}`);
}

console.log('[static] manifest, pages and icons copied');
