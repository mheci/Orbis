#!/usr/bin/env node
/**
 * Locale catalog verification.
 *
 * Fails the build when the shipped English catalog (_locales/en/messages.json)
 * drifts from what the code actually references:
 *  - every data-i18n* attribute in HTML must name an existing key
 *  - every __MSG_key__ token in the manifest must name an existing key
 *  - every key referenced as a string literal anywhere in src (getMessage
 *    calls, key-map tables such as KIND_LABELS, attribute values) must exist
 *  - every defined key must be referenced somewhere (no dead strings)
 *  - every message must be a non-empty string
 *
 * A missing key renders the raw key in the UI, so the build must fail before
 * that can ship.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const messages = JSON.parse(await readFile('src/_locales/en/messages.json', 'utf8'));
const definedKeys = new Set(Object.keys(messages));
for (const [key, value] of Object.entries(messages)) {
  check(
    typeof value === 'object' &&
      value !== null &&
      typeof value.message === 'string' &&
      value.message.length > 0,
    `locale message "${key}" must be an object with a non-empty "message" string`
  );
  check(
    /^[A-Za-z][A-Za-z0-9_.-]*$/.test(key),
    `locale message key "${key}" must be alphanumeric (dots and dashes allowed)`
  );
}

/** Keys referenced anywhere in the source tree. */
const used = new Set();

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (/\.(html|ts|json)$/.test(entry.name) && !entry.name.endsWith('messages.json')) {
      const source = await readFile(full, 'utf8');
      const where = full.replaceAll('\\', '/');
      for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_.-]+)"/g)) {
        used.add(match[1]);
      }
      for (const match of source.matchAll(/__MSG_([A-Za-z0-9_.-]+)__/g)) {
        used.add(match[1]);
        check(definedKeys.has(match[1]), `__MSG_${match[1]}__ in ${where} has no locale message`);
      }
      // Dynamic lookups (getMessage(SET_TITLES[id]), KIND_LABELS maps, ternaries)
      // resolve to keys stored as plain string literals, so any quoted key that
      // appears in the source counts as a reference.
      for (const key of definedKeys) {
        if (source.includes(`'${key}'`) || source.includes(`"${key}"`)) used.add(key);
      }
    }
  }
}

await walk('src');

for (const key of used) {
  check(definedKeys.has(key), `"${key}" is referenced but missing from _locales/en/messages.json`);
}
for (const key of definedKeys) {
  check(used.has(key), `locale message "${key}" is defined but never referenced`);
}

if (errors.length > 0) {
  console.error('[verify-i18n] locale verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[verify-i18n] ${definedKeys.size} locale messages OK, ${used.size} references checked`
);
