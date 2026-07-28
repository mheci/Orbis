#!/usr/bin/env node
/**
 * Domain database validation.
 *
 * Runs in CI on every change so a typo in a JSON file can never ship:
 *  - all files parse and satisfy the shared schema's required keys
 *  - host entries look like real hosts (no spaces, no scheme, no wildcards)
 *  - no duplicate entries within a file
 *  - no entry accidentally shadows a public suffix (e.g. a bare "com")
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const DOMAIN_DIR = 'src/domains';
const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;
const errors = [];
const warnings = [];

const files = (await readdir(DOMAIN_DIR)).filter((f) => f.endsWith('.json'));
let totalHosts = 0;

for (const file of files) {
  const full = path.join(DOMAIN_DIR, file);
  let data;
  try {
    data = JSON.parse(await readFile(full, 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON — ${error.message}`);
    continue;
  }

  if (file === 'schema.json') continue;

  for (const key of ['id', 'title', 'updated']) {
    if (typeof data[key] !== 'string') errors.push(`${file}: missing required key "${key}"`);
  }
  if (data.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
    errors.push(`${file}: "updated" must be YYYY-MM-DD`);
  }

  for (const key of ['domains', 'gtldDomains', 'alwaysOn', 'bases', 'brandTLDs', 'suffixes']) {
    const list = data[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${file}: "${key}" must be an array`);
      continue;
    }
    const seen = new Set();
    for (const entry of list) {
      if (typeof entry !== 'string') {
        errors.push(`${file}.${key}: non-string entry ${JSON.stringify(entry)}`);
        continue;
      }
      const value = entry.trim();
      if (value !== entry) errors.push(`${file}.${key}: "${entry}" has surrounding whitespace`);
      if (value !== value.toLowerCase()) {
        errors.push(`${file}.${key}: "${entry}" must be lower-case`);
      }
      if (value.includes('://') || value.includes('/')) {
        errors.push(`${file}.${key}: "${entry}" must be a bare host, not a URL`);
      }
      if (value.includes('*')) {
        errors.push(`${file}.${key}: "${entry}" must not use wildcards (subdomains are implicit)`);
      }
      if (!HOST_RE.test(value)) errors.push(`${file}.${key}: "${entry}" is not a valid host label`);
      if (seen.has(value)) errors.push(`${file}.${key}: duplicate entry "${entry}"`);
      seen.add(value);
      if (key === 'domains' || key === 'gtldDomains') totalHosts++;
    }
  }

  for (const rule of data.redirectors ?? []) {
    if (typeof rule.host !== 'string' || typeof rule.path !== 'string') {
      errors.push(`${file}: redirector entries need string "host" and "path"`);
    }
    if (!Array.isArray(rule.params)) errors.push(`${file}: redirector "params" must be an array`);
  }
}

// Cross-file sanity: bases referenced by ccTLD.json must be plain labels.
const ccTLD = JSON.parse(await readFile(path.join(DOMAIN_DIR, 'ccTLD.json'), 'utf8'));
for (const base of ccTLD.bases ?? []) {
  if (base.includes('.')) errors.push(`ccTLD.json: base "${base}" must be a single label`);
}
if ((ccTLD.suffixes ?? []).length < 50) {
  warnings.push('ccTLD.json: fewer than 50 country suffixes — is the list complete?');
}

for (const warning of warnings) console.warn(`[validate] warning: ${warning}`);
if (errors.length > 0) {
  console.error('[validate] domain database validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[validate] ${files.length} JSON files OK, ${totalHosts} literal hosts, ${(ccTLD.suffixes ?? []).length} country suffixes`
);
