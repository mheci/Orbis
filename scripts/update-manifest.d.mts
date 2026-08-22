/**
 * Type surface of scripts/update-manifest.mjs for the test suite and editor.
 * The script itself is plain JavaScript run by node/bun; these declarations
 * only describe the exported pure helpers.
 */

export declare const ADDON_ID: string;
export declare const DEFAULT_REPO: string;

export interface UpdateManifestEntry {
  version: string;
  update_link: string;
  update_hash?: string;
}

export interface UpdateManifest {
  id: string;
  versions: UpdateManifestEntry[];
}

export interface ReleaseLike {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; digest?: string }>;
}

export declare function buildUpdateManifest(
  releases: unknown,
  options?: { id?: string; repo?: string }
): UpdateManifest;
