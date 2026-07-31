/** Settings validation, sanitisation, migration and backup round-trip tests. */

import { describe, expect, it } from 'vitest';
import {
  buildBackup,
  canonicalizeUserPattern,
  defaultSettings,
  mergeSettings,
  migrateSettings,
  parseBackup,
  sanitizeSettings,
} from '../src/core/settings.js';
import { SETTINGS_SCHEMA_VERSION } from '../src/types/index.js';

describe('defaults', () => {
  it('produces a valid, protective default configuration', () => {
    const settings = defaultSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.pausedUntil).toBe(0);
    expect(settings.container.name).toBe('Google');
    expect(settings.domainSets['google']).toBe(true);
    expect(settings.domainSets['youtube']).toBe(true);
    // Risky sets stay off until the user opts in.
    expect(settings.domainSets['trackers']).toBe(false);
    expect(settings.domainSets['hosting']).toBe(false);
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });
});

describe('sanitizeSettings', () => {
  it('rejects non-objects', () => {
    for (const input of [null, undefined, 42, 'x', [], true]) {
      expect(sanitizeSettings(input).enabled).toBe(true);
    }
  });

  it('drops unknown keys', () => {
    const result = sanitizeSettings({ enabled: true, evil: 'payload' }) as unknown as Record<
      string,
      unknown
    >;
    expect(result['evil']).toBeUndefined();
  });

  it('replaces wrong types with defaults', () => {
    const result = sanitizeSettings({
      enabled: 'yes',
      pausedUntil: 'soon',
      container: { name: 42, color: 'octarine', icon: 'skull' },
      behaviour: { unwrapRedirectors: 'nope' },
    });
    expect(result.enabled).toBe(true);
    expect(result.pausedUntil).toBe(0);
    expect(result.container.name).toBe('Google');
    expect(result.container.color).toBe('red');
    expect(result.container.icon).toBe('fingerprint');
    expect(result.behaviour.unwrapRedirectors).toBe(true);
  });

  it('normalises and de-duplicates pattern lists', () => {
    const result = sanitizeSettings({
      neverContainerize: [
        'https://Example.COM/',
        'example.com',
        '*.example.com',
        '   ',
        123,
        'bad host with spaces',
      ],
    });
    expect(result.neverContainerize).toEqual(['example.com']);
  });

  it('caps oversized lists', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `host${i}.example.com`);
    expect(sanitizeSettings({ alwaysContainerize: huge }).alwaysContainerize.length).toBe(2000);
  });

  it('sanitises exceptions and keeps the enabled flag', () => {
    const result = sanitizeSettings({
      exceptions: [
        { pattern: 'mail.example.com', enabled: false, created: 1 },
        { pattern: '', enabled: true },
        { nope: true },
        'string',
      ],
    });
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]!.pattern).toBe('mail.example.com');
    expect(result.exceptions[0]!.enabled).toBe(false);
  });

  it('rejects negative or non-finite statistics', () => {
    const result = sanitizeSettings({
      statistics: { containedNavigations: -5, releasedNavigations: Number.NaN },
    });
    expect(result.statistics.containedNavigations).toBe(0);
    expect(result.statistics.releasedNavigations).toBe(0);
  });

  it('truncates an over-long container name', () => {
    const result = sanitizeSettings({ container: { name: 'x'.repeat(500) } });
    expect(result.container.name.length).toBe(64);
  });
});

describe('mergeSettings', () => {
  it('applies nested patches without dropping siblings', () => {
    const base = defaultSettings();
    const merged = mergeSettings(base, { behaviour: { useSync: true } });
    expect(merged.behaviour.useSync).toBe(true);
    expect(merged.behaviour.unwrapRedirectors).toBe(true);
    expect(merged.container.name).toBe('Google');
  });

  it('merges domain set toggles', () => {
    const merged = mergeSettings(defaultSettings(), { domainSets: { trackers: true } });
    expect(merged.domainSets['trackers']).toBe(true);
    expect(merged.domainSets['google']).toBe(true);
  });

  it('re-sanitises the merged result', () => {
    const merged = mergeSettings(defaultSettings(), {
      container: { color: 'not-a-colour' },
    } as never);
    expect(merged.container.color).toBe('red');
  });
});

describe('migrations', () => {
  it('upgrades a v0 document with a legacy whitelist', () => {
    const migrated = migrateSettings({ whitelist: ['legacy.example.com'], enabled: false });
    expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.neverContainerize).toEqual(['legacy.example.com']);
    expect(migrated.enabled).toBe(false);
  });

  it('passes a current document through unchanged', () => {
    const current = defaultSettings();
    expect(migrateSettings(current)).toEqual(current);
  });

  it('falls back to defaults for garbage', () => {
    expect(migrateSettings('corrupted').enabled).toBe(true);
  });
});

describe('backup round-trip', () => {
  it('exports and re-imports identical settings', () => {
    const original = mergeSettings(defaultSettings(), {
      container: { name: 'Big G', color: 'purple' },
      neverContainerize: ['sso.example.com'],
    });
    const backup = buildBackup(original);
    const restored = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(restored).toEqual(original);
  });

  it('rejects a file without the format marker', () => {
    expect(() => parseBackup({ settings: {} })).toThrow(/format marker/);
  });

  it('rejects a newer schema version', () => {
    expect(() => parseBackup({ format: 'orbis-backup', version: 99, settings: {} })).toThrow(
      /newer than this extension/
    );
  });

  it('sanitises malicious imports', () => {
    const restored = parseBackup({
      format: 'orbis-backup',
      version: 1,
      settings: {
        enabled: true,
        neverContainerize: ['javascript:alert(1)', 'ok.example.com'],
        container: { name: '<script>x</script>' },
      },
    });
    expect(restored.neverContainerize).toEqual(['ok.example.com']);
    expect(restored.container.name).toBe('<script>x</script>'.slice(0, 64));
    expect(restored.container.color).toBe('red');
  });
});

describe('canonicalizeUserPattern', () => {
  it.each([
    ['https://Mail.Example.com/inbox', 'mail.example.com/inbox'],
    ['  example.com  ', 'example.com'],
    ['*.example.com', 'example.com'],
  ])('canonicalises %s', (input, expected) => {
    expect(canonicalizeUserPattern(input)).toBe(expected);
  });

  it.each(['', 'localhost', 'not a host', '///'])('rejects %s', (input) => {
    expect(canonicalizeUserPattern(input)).toBeNull();
  });
});
