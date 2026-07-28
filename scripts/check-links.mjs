#!/usr/bin/env node
/**
 * Repository link hygiene check.
 *
 * The project was migrated from the `mheci` GitHub account to `astarling-x`,
 * and the old account was deleted. Every link to it is now a 404 — including
 * the CI badge, the clone URLs in the install instructions and, most seriously,
 * the private vulnerability-reporting link in SECURITY.md.
 *
 * A dead security-reporting link is a real problem: a researcher who cannot
 * find a private channel may disclose publicly instead. So this runs in CI and
 * fails the build if a retired owner reappears anywhere in the tree.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const CANONICAL_OWNER = 'astarling-x';
const RETIRED_OWNERS = ['mheci'];

const SCAN_EXTENSIONS = new Set(['.md', '.json', '.yml', '.yaml', '.ts', '.mjs', '.js', '.html']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'web-ext-artifacts',
  '.git',
  '.github/cache',
]);
// These two files are the enforcement mechanism itself: they must name the
// retired account in order to detect it. Everything else in the tree must not.
const SKIP_FILES = new Set(['package-lock.json', 'check-links.mjs', 'verify-manifest.mjs']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const errors = [];
const files = await walk('.');

/**
 * Only *actionable* references are errors: a URL someone could click, a git
 * remote someone could clone, or an extension id that would change the add-on's
 * identity. Prose that documents the migration (CHANGELOG, ARCHITECTURE) is
 * legitimate and must be allowed, otherwise the project cannot record its own
 * history. Matching links rather than bare names keeps that distinction.
 */
function actionableReferences(line, retired) {
  const patterns = [
    new RegExp(`github\\.com[/:]${retired}\\b`, 'i'), // links and git remotes
    new RegExp(`@${retired}\\.github\\.io`, 'i'), // extension id
    new RegExp(`${retired}\\.github\\.io/`, 'i'), // pages URLs
  ];
  return patterns.some((pattern) => pattern.test(line));
}

for (const file of files) {
  const content = await readFile(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const retired of RETIRED_OWNERS) {
      // Inline code spans are how the docs quote the old id when explaining the
      // migration; a quoted example is not a live link.
      const stripped = line.replace(/`[^`]*`/g, '');
      if (actionableReferences(stripped, retired)) {
        errors.push(
          `${file}:${index + 1} links to the retired account "${retired}" — use "${CANONICAL_OWNER}"\n      ${line.trim().slice(0, 120)}`
        );
      }
    }
  });
}

// The canonical owner must actually be present, otherwise a careless
// find-and-replace could strip every repository link and this check would
// vacuously pass.
const readme = await readFile('README.md', 'utf8');
if (!readme.includes(`github.com/${CANONICAL_OWNER}/g-container`)) {
  errors.push(`README.md does not link to github.com/${CANONICAL_OWNER}/g-container`);
}

if (errors.length > 0) {
  console.error('[links] repository link check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[links] ${files.length} files scanned, all repository links point at "${CANONICAL_OWNER}"`
);
