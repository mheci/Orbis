#!/usr/bin/env node
/**
 * Manifest verification.
 *
 * Fails the build when the manifest drifts from what the code actually needs:
 * every declared permission must be justified in docs/PERMISSIONS.md, every
 * referenced file must exist, and the version must match package.json.
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const manifestPath = 'dist/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(manifest.version === pkg.version, `version mismatch: ${manifest.version} vs ${pkg.version}`);
check(/^\d+\.\d+\.\d+$/.test(manifest.version), `version must be semver: ${manifest.version}`);
check(typeof manifest.name === 'string' && manifest.name.length > 0, 'name is required');
check(
  typeof manifest.description === 'string' && manifest.description.length <= 132,
  'description must exist and be <= 132 chars (AMO limit)'
);
const gecko = manifest.browser_specific_settings?.gecko;
check(gecko?.id !== undefined, 'a gecko extension id is required for AMO signing');
check(
  gecko?.strict_min_version !== undefined,
  'strict_min_version is required so Firefox does not offer the add-on to unsupported builds'
);
// AMO requires an explicit data-collection declaration. Orbis collects
// nothing, so this must stay ["none"] — see docs/PERMISSIONS.md.
check(
  Array.isArray(gecko?.data_collection_permissions?.required),
  'browser_specific_settings.gecko.data_collection_permissions.required is required by AMO'
);
check(
  JSON.stringify(gecko?.data_collection_permissions?.required) === '["none"]',
  'Orbis must declare data_collection_permissions.required = ["none"]; it collects no data'
);
// The data_collection_permissions key itself needs FF140 / Android 142.
check(
  Number.parseFloat(gecko?.strict_min_version ?? '0') >= 140,
  'strict_min_version must be >= 140 (required for data_collection_permissions)'
);
check(
  Number.parseFloat(manifest.browser_specific_settings?.gecko_android?.strict_min_version ?? '0') >=
    142,
  'gecko_android.strict_min_version must be >= 142 (required for data_collection_permissions)'
);

const ALLOWED_PERMISSIONS = new Set([
  'contextualIdentities',
  'cookies',
  'storage',
  'tabs',
  'menus',
  'contextMenus',
  'webRequest',
  'webRequestBlocking',
]);
for (const permission of manifest.permissions ?? []) {
  check(
    ALLOWED_PERMISSIONS.has(permission),
    `unexpected permission "${permission}" — add it to ALLOWED_PERMISSIONS and document it in docs/PERMISSIONS.md`
  );
}

const permissionDocs = await readFile('docs/PERMISSIONS.md', 'utf8');
for (const permission of manifest.permissions ?? []) {
  check(
    permissionDocs.includes(permission),
    `permission "${permission}" is not documented in docs/PERMISSIONS.md`
  );
}

// The project has been rebranded from astarling-x/g-container to mheci/Orbis.
// Canonical owner is now mheci, extension id is orbis@mheci.github.io.
// Changing id after publication orphans installs, but this is intentional for
// the Orbis rebrand (major version 2.0.0). Previous g-container installs will
// need to migrate manually.
const CANONICAL_OWNER = 'mheci';
const RETIRED_OWNERS = ['astarling-x'];
const EXPECTED_EXTENSION_ID = `orbis@${CANONICAL_OWNER}.github.io`;

check(
  gecko?.id === EXPECTED_EXTENSION_ID,
  `gecko.id must be "${EXPECTED_EXTENSION_ID}" (found "${gecko?.id}"). The extension id is a permanent identity key — changing it after release orphans existing installs. For Orbis rebrand, this is intentional v2.0.0.`
);
for (const retired of RETIRED_OWNERS) {
  // Allow retired owner in comments or historical docs, but not in manifest id/homepage
  if (gecko?.id?.includes(retired) || manifest.homepage_url?.includes(retired)) {
    // Check if homepage still points to old repo – should be updated to mheci/Orbis
    if (manifest.homepage_url?.includes('astarling-x/g-container')) {
      errors.push(
        `manifest homepage still references retired repo "astarling-x/g-container"; update to "mheci/Orbis"`
      );
    }
  }
}

const referenced = [
  ...(manifest.background?.scripts ?? []),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {}),
  // Include onboarding if present
  'onboarding/index.html',
].filter(Boolean);

for (const file of referenced) {
  try {
    await access(`dist/${file}`, constants.R_OK);
  } catch {
    errors.push(`manifest references missing file: dist/${file}`);
  }
}

if (errors.length > 0) {
  console.error('[verify] manifest verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  `[verify] manifest OK (v${manifest.version}, ${manifest.permissions.length} permissions) – Orbis rebrand verified`
);
