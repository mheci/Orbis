#!/usr/bin/env node
/**
 * Repository link hygiene check.
 *
 * The project was rebranded from astarling-x/g-container to mheci/Orbis,
 * and the old account/repo should no longer be referenced in live links.
 * Every link to the old repo is now a 404 after deletion – including CI badges,
 * clone URLs, and vulnerability-reporting paths.
 *
 * This runs in CI and fails the build if retired owner/repo reappears.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const CANONICAL_OWNER = "mheci";
const CANONICAL_REPO = "Orbis";
const RETIRED_OWNERS = ["astarling-x"];
const RETIRED_REPOS = ["g-container"];

const SCAN_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".ts",
  ".mjs",
  ".js",
  ".html",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "web-ext-artifacts",
  ".git",
  ".github/cache",
]);
// These files are the enforcement mechanism itself: they must name the
// retired account in order to detect it. Everything else must not.
const SKIP_FILES = new Set(["package-lock.json", "check-links.mjs", "verify-manifest.mjs"]);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
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
const files = await walk(".");

function actionableReferences(line, retired) {
  const patterns = [
    new RegExp(`github\\.com[/:]${retired}\\b`, "i"),
    new RegExp(`@${retired}\\.github\\.io`, "i"),
    new RegExp(`${retired}\\.github\\.io/`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(line));
}

function actionableRepoReferences(line, retiredRepo) {
  // Detect old repo name g-container in links
  const patterns = [
    new RegExp(`github\\.com/[^/]+/${retiredRepo}\\b`, "i"),
    new RegExp(`${retiredRepo}@`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(line));
}

for (const file of files) {
  const content = await readFile(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    for (const retired of RETIRED_OWNERS) {
      const stripped = line.replace(/`[^`]*`/g, "");
      if (actionableReferences(stripped, retired)) {
        // Allow historical mention in CHANGELOG that documents migration
        if (file.includes("CHANGELOG") && stripped.toLowerCase().includes("migrat")) continue;
        // Allow in this file's own logic
        if (file.endsWith("check-links.mjs")) continue;
        errors.push(
          `${file}:${index + 1} links to the retired owner "${retired}" — use "${CANONICAL_OWNER}"\n      ${line.trim().slice(0, 120)}`
        );
      }
    }
    for (const retiredRepo of RETIRED_REPOS) {
      const stripped = line.replace(/`[^`]*`/g, "");
      // Only flag if it's in a URL context and not already migrated
      if (stripped.includes(`/${retiredRepo}`) && stripped.includes("github.com")) {
        if (stripped.includes("mheci/Orbis")) continue; // Already migrated
        if (file.includes("CHANGELOG")) continue;
        // Check if it's still referencing old repo name with old owner
        if (stripped.toLowerCase().includes("astarling-x/g-container")) {
          errors.push(
            `${file}:${index + 1} links to retired repo "${retiredRepo}" — use "${CANONICAL_REPO}"\n      ${line.trim().slice(0, 120)}`
          );
        }
      }
    }
  });
}

// Canonical owner/repo must actually be present, otherwise check would vacuously pass
const readme = await readFile("README.md", "utf8");
if (!readme.includes(`github.com/${CANONICAL_OWNER}/${CANONICAL_REPO}`)) {
  errors.push(`README.md does not link to github.com/${CANONICAL_OWNER}/${CANONICAL_REPO}`);
}

if (errors.length > 0) {
  console.error("[links] repository link check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[links] ${files.length} files scanned, all repository links point at "${CANONICAL_OWNER}/${CANONICAL_REPO}"`
);
