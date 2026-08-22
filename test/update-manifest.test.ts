/**
 * Tests for the self-hosted update channel manifest generator.
 *
 * The mapping rules are the contract: every published release with a signed
 * XPI becomes an entry with a pinned per-release download URL, drafts and
 * unsigned releases are skipped, ordering is newest-first, and sha256 digests
 * become Firefox-verifiable update_hash pins.
 */

import { describe, expect, it } from 'vitest';
import { ADDON_ID, buildUpdateManifest } from '../scripts/update-manifest.mjs';

function release(tag: string, xpiName: string | null, digest?: string) {
  const assets =
    xpiName === null ? [] : [{ name: xpiName, digest: digest ?? `sha256:${'a'.repeat(64)}` }];
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets,
  };
}

describe('buildUpdateManifest', () => {
  it('maps each signed release to a pinned download entry', () => {
    const manifest = buildUpdateManifest([
      release('v2.3.0', 'orbis-2.3.0-signed.xpi'),
      release('v2.2.1', 'orbis-2.2.1-signed.xpi'),
    ]);
    expect(manifest.id).toBe(ADDON_ID);
    expect(manifest.versions).toEqual([
      {
        version: '2.3.0',
        update_link:
          'https://github.com/mheci/Orbis/releases/download/v2.3.0/orbis-2.3.0-signed.xpi',
        update_hash: 'sha256:' + 'a'.repeat(64),
      },
      {
        version: '2.2.1',
        update_link:
          'https://github.com/mheci/Orbis/releases/download/v2.2.1/orbis-2.2.1-signed.xpi',
        update_hash: 'sha256:' + 'a'.repeat(64),
      },
    ]);
  });

  it('sorts versions newest-first regardless of input order', () => {
    const manifest = buildUpdateManifest([
      release('v2.10.0', 'orbis-2.10.0-signed.xpi'),
      release('v2.9.0', 'orbis-2.9.0-signed.xpi'),
      release('v2.100.0', 'orbis-2.100.0-signed.xpi'),
    ]);
    expect(manifest.versions.map((v) => v.version)).toEqual(['2.100.0', '2.10.0', '2.9.0']);
  });

  it('skips drafts, untagged releases and releases without a signed XPI', () => {
    const manifest = buildUpdateManifest([
      { ...release('v2.4.0', null), draft: true },
      release('v2.3.1', 'orbis-2.3.1.zip'),
      release('not-a-version', 'orbis-not-a-version-signed.xpi'),
      release('v2.3.0', 'orbis-2.3.0-signed.xpi'),
    ]);
    expect(manifest.versions.map((v) => v.version)).toEqual(['2.3.0']);
  });

  it('omits update_hash when the API reports no digest', () => {
    const manifest = buildUpdateManifest([release('v2.3.0', 'orbis-2.3.0-signed.xpi', undefined)]);
    // release() always fills a digest; strip it explicitly here.
    const bare = buildUpdateManifest([
      {
        tag_name: 'v2.3.0',
        draft: false,
        prerelease: false,
        assets: [{ name: 'orbis-2.3.0-signed.xpi' }],
      },
    ]);
    expect(manifest.versions[0]!.update_hash).toBeDefined();
    expect(bare.versions[0]).toEqual({
      version: '2.3.0',
      update_link: 'https://github.com/mheci/Orbis/releases/download/v2.3.0/orbis-2.3.0-signed.xpi',
    });
  });

  it('ignores digests that are not plain sha256 strings', () => {
    const manifest = buildUpdateManifest([
      {
        tag_name: 'v2.3.0',
        draft: false,
        prerelease: false,
        assets: [{ name: 'orbis-2.3.0-signed.xpi', digest: 'md5:zzz' }],
      },
    ]);
    expect(manifest.versions[0]!.update_hash).toBeUndefined();
  });

  it('throws on a non-array payload', () => {
    expect(() => buildUpdateManifest({ id: 'x' })).toThrow(/array/);
  });
});
