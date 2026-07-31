/**
 * Settings persistence, validation and migration.
 *
 * Storage strategy
 * ----------------
 * `storage.local` is always authoritative — it works in every Firefox build and
 * survives when Sync is unavailable. When the user opts in, settings are also
 * mirrored to `storage.sync`; on startup the newer of the two wins. Any storage
 * failure degrades to in-memory defaults rather than breaking the extension.
 *
 * Everything read from storage or from an imported file is passed through
 * `sanitizeSettings`, which rebuilds a known-good object field by field. Unknown
 * keys are dropped, wrong types are replaced with defaults, and lists are capped,
 * so corrupted or malicious input can never reach the matcher.
 */

import {
  CONTAINER_COLORS,
  CONTAINER_ICONS,
  SETTINGS_SCHEMA_VERSION,
  type BackupDocument,
  type ContainerColor,
  type BlockingMode,
  type ContainerIcon,
  type DeepPartial,
  type ExceptionRule,
  type Settings,
  type Statistics,
} from '../types/index.js';
import { getDomainDatabase, normalizeHostPattern } from './domain-db.js';
import { parseHostPathRule } from './matcher.js';

export const STORAGE_KEY = 'settings';
/** Accepted blocking modes; anything else falls back to the default. */
const BLOCKING_MODES: readonly BlockingMode[] = ['off', 'standard', 'strict'];
/** Guard rails so a corrupt import cannot blow up memory. */
const MAX_LIST_ENTRIES = 2000;
const MAX_PATTERN_LENGTH = 253 + 512;

export function defaultStatistics(): Statistics {
  return {
    containedNavigations: 0,
    releasedNavigations: 0,
    unwrappedLinks: 0,
    exceptionsApplied: 0,
    trackersBlocked: 0,
    since: Date.now(),
    lastEvent: 0,
  };
}

export function defaultSettings(): Settings {
  const domainSets: Record<string, boolean> = {};
  for (const set of getDomainDatabase().sets) domainSets[set.id] = set.defaultEnabled;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: true,
    pausedUntil: 0,
    container: { name: 'Orbis', color: 'red', icon: 'fingerprint' },
    behaviour: {
      unwrapRedirectors: true,
      oauthPassthrough: true,
      releaseNonGoogle: true,
      handlePrivateWindows: false,
      collectStatistics: true,
      useSync: false,
    },
    blocking: {
      // Standard blocks analytics, advertising and social widgets on sites that
      // are not Google. Fonts, hosted libraries, reCAPTCHA, maps and embeds are
      // left alone, because blocking those by default would break a large share
      // of the web rather than protect anyone.
      mode: 'standard',
      allowlist: [],
      showBadge: true,
    },
    domainSets,
    alwaysContainerize: [],
    neverContainerize: [],
    exceptions: [],
    statistics: defaultStatistics(),
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

function asString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, maxLength);
}

/** Accept only patterns that the matcher can actually compile. */
function sanitizePatternList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (entry.length > MAX_PATTERN_LENGTH) continue;
    const parsed = parseHostPathRule(entry);
    if (parsed === null) continue;
    const canonical = parsed.path === '' ? parsed.host : `${parsed.host}${parsed.path}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= MAX_LIST_ENTRIES) break;
  }
  return out;
}

function sanitizeExceptions(value: unknown): ExceptionRule[] {
  if (!Array.isArray(value)) return [];
  const out: ExceptionRule[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const parsed =
      typeof record['pattern'] === 'string' ? parseHostPathRule(record['pattern']) : null;
    if (parsed === null) continue;
    const canonical = parsed.path === '' ? parsed.host : `${parsed.host}${parsed.path}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({
      pattern: canonical,
      note: typeof record['note'] === 'string' ? record['note'].slice(0, 200) : undefined,
      enabled: asBoolean(record['enabled'], true),
      created: asFiniteNumber(record['created'], Date.now()),
    });
    if (out.length >= MAX_LIST_ENTRIES) break;
  }
  return out;
}

function sanitizeStatistics(value: unknown): Statistics {
  const base = defaultStatistics();
  if (typeof value !== 'object' || value === null) return base;
  const record = value as Record<string, unknown>;
  return {
    containedNavigations: asFiniteNumber(record['containedNavigations'], 0),
    releasedNavigations: asFiniteNumber(record['releasedNavigations'], 0),
    unwrappedLinks: asFiniteNumber(record['unwrappedLinks'], 0),
    exceptionsApplied: asFiniteNumber(record['exceptionsApplied'], 0),
    trackersBlocked: asFiniteNumber(record['trackersBlocked'], 0),
    since: asFiniteNumber(record['since'], base.since),
    lastEvent: asFiniteNumber(record['lastEvent'], 0),
  };
}

/** Rebuild a fully valid Settings object from arbitrary untrusted input. */
export function sanitizeSettings(input: unknown): Settings {
  const defaults = defaultSettings();
  if (typeof input !== 'object' || input === null) return defaults;
  const record = input as Record<string, unknown>;

  const containerRaw =
    typeof record['container'] === 'object' && record['container'] !== null
      ? (record['container'] as Record<string, unknown>)
      : {};
  const behaviourRaw =
    typeof record['behaviour'] === 'object' && record['behaviour'] !== null
      ? (record['behaviour'] as Record<string, unknown>)
      : {};
  const blockingRaw =
    typeof record['blocking'] === 'object' && record['blocking'] !== null
      ? (record['blocking'] as Record<string, unknown>)
      : {};

  const setsRaw =
    typeof record['domainSets'] === 'object' && record['domainSets'] !== null
      ? (record['domainSets'] as Record<string, unknown>)
      : {};

  const color = containerRaw['color'];
  const icon = containerRaw['icon'];

  const domainSets: Record<string, boolean> = {};
  for (const set of getDomainDatabase().sets) {
    domainSets[set.id] = asBoolean(setsRaw[set.id], set.defaultEnabled);
  }

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: asBoolean(record['enabled'], defaults.enabled),
    pausedUntil: asFiniteNumber(record['pausedUntil'], 0),
    container: {
      name: asString(containerRaw['name'], defaults.container.name, 64),
      color: CONTAINER_COLORS.includes(color as ContainerColor)
        ? (color as ContainerColor)
        : defaults.container.color,
      icon: CONTAINER_ICONS.includes(icon as ContainerIcon)
        ? (icon as ContainerIcon)
        : defaults.container.icon,
    },
    behaviour: {
      unwrapRedirectors: asBoolean(
        behaviourRaw['unwrapRedirectors'],
        defaults.behaviour.unwrapRedirectors
      ),
      oauthPassthrough: asBoolean(
        behaviourRaw['oauthPassthrough'],
        defaults.behaviour.oauthPassthrough
      ),
      releaseNonGoogle: asBoolean(
        behaviourRaw['releaseNonGoogle'],
        defaults.behaviour.releaseNonGoogle
      ),
      handlePrivateWindows: asBoolean(
        behaviourRaw['handlePrivateWindows'],
        defaults.behaviour.handlePrivateWindows
      ),
      collectStatistics: asBoolean(
        behaviourRaw['collectStatistics'],
        defaults.behaviour.collectStatistics
      ),
      useSync: asBoolean(behaviourRaw['useSync'], defaults.behaviour.useSync),
    },
    blocking: {
      mode: BLOCKING_MODES.includes(blockingRaw['mode'] as BlockingMode)
        ? (blockingRaw['mode'] as BlockingMode)
        : defaults.blocking.mode,
      allowlist: sanitizePatternList(blockingRaw['allowlist']),
      showBadge: asBoolean(blockingRaw['showBadge'], defaults.blocking.showBadge),
    },
    domainSets,
    alwaysContainerize: sanitizePatternList(record['alwaysContainerize']),
    neverContainerize: sanitizePatternList(record['neverContainerize']),
    exceptions: sanitizeExceptions(record['exceptions']),
    statistics: sanitizeStatistics(record['statistics']),
  };
}

/** Apply a partial patch on top of existing settings, then re-sanitize. */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merged: Record<string, unknown> = { ...base, ...patch };
  if (patch.container !== undefined) {
    merged['container'] = { ...base.container, ...patch.container };
  }
  if (patch.behaviour !== undefined) {
    merged['behaviour'] = { ...base.behaviour, ...patch.behaviour };
  }
  if (patch.blocking !== undefined) {
    merged['blocking'] = { ...base.blocking, ...patch.blocking };
  }
  if (patch.domainSets !== undefined) {
    merged['domainSets'] = { ...base.domainSets, ...patch.domainSets };
  }
  if (patch.statistics !== undefined) {
    merged['statistics'] = { ...base.statistics, ...patch.statistics };
  }
  return sanitizeSettings(merged);
}

/**
 * Migrate an older persisted document to the current schema.
 * Kept explicit (rather than implicit via sanitize) so that future breaking
 * changes have a documented, testable upgrade path.
 */
export function migrateSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return defaultSettings();
  const record = raw as Record<string, unknown>;
  const version = asFiniteNumber(record['schemaVersion'], 0);

  const working: Record<string, unknown> = { ...record };

  if (version < 1) {
    // v0 (pre-release dev builds) stored a flat `whitelist` array.
    if (Array.isArray(working['whitelist'])) {
      working['neverContainerize'] = working['whitelist'];
      delete working['whitelist'];
    }
    working['schemaVersion'] = 1;
  }

  return sanitizeSettings(working);
}

export function buildBackup(settings: Settings): BackupDocument {
  return {
    format: 'orbis-backup',
    version: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };
}

/** Validate and unpack an imported backup document. Throws on malformed input. */
export function parseBackup(input: unknown): Settings {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Backup must be a JSON object.');
  }
  const record = input as Record<string, unknown>;
  const format = record['format'];
  if (format !== 'orbis-backup' && format !== 'g-container-backup') {
    throw new Error('Not a Orbis backup file (missing format marker).');
  }
  const version = asFiniteNumber(record['version'], 0);
  if (version > SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `Backup schema v${version} is newer than this extension supports (v${SETTINGS_SCHEMA_VERSION}). Please update Orbis.`
    );
  }
  return migrateSettings({ ...(record['settings'] as object), schemaVersion: version });
}

/** Convenience used by the UI to canonicalise a host typed by the user. */
export function canonicalizeUserPattern(raw: string): string | null {
  const parsed = parseHostPathRule(raw);
  if (parsed === null) return null;
  const host = normalizeHostPattern(parsed.host);
  if (!host.includes('.')) return null;
  return parsed.path === '' ? host : `${host}${parsed.path}`;
}
