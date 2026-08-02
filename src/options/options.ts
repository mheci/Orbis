/**
 * Options page controller.
 *
 * Like the popup, this page holds no authoritative state — it renders whatever
 * the background worker reports and sends patches back. All writes go through
 * `set-settings`, which re-sanitises the whole document, so the UI cannot put
 * the extension into an invalid state.
 */

import {
  CONTAINER_COLORS,
  CONTAINER_ICONS,
  type AddRulesResult,
  type BackupDocument,
  type DecisionEntry,
  type DeepPartial,
  type Diagnostics,
  type ExceptionRule,
  type MatchResult,
  type Message,
  type Settings,
} from '../types/index.js';
import { getMessage, localizePage } from '../shared/i18n.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing #${id}`);
  return el as T;
};

async function send<T>(message: Message): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as T & { error?: string };
  if (response !== null && typeof response === 'object' && 'error' in response) {
    throw new Error(String((response as { error: string }).error));
  }
  return response;
}

let settings: Settings;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function toast(text: string): void {
  const node = $('status');
  node.textContent = text;
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    node.textContent = '';
  }, 3000);
}

/**
 * Apply a partial settings update.
 *
 * The worker re-sanitises the whole document, so the UI cannot drive it into an
 * invalid state; a rejected patch surfaces as a toast rather than a silent
 * no-op, which is what makes a failed save visible to the user.
 */
async function patch(update: DeepPartial<Settings>): Promise<void> {
  try {
    settings = await send<Settings>({ type: 'set-settings', patch: update });
    render();
    toast(getMessage('optionsSaved'));
  } catch (error) {
    toast(getMessage('optionsSaveFailed', error instanceof Error ? error.message : String(error)));
  }
}

// ------------------------------------------------------------------ rendering

function fillSelect(select: HTMLSelectElement, values: readonly string[], selected: string): void {
  select.textContent = '';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value[0]!.toUpperCase() + value.slice(1);
    option.selected = value === selected;
    select.append(option);
  }
}

function renderList(
  container: HTMLElement,
  entries: readonly string[],
  list: 'always' | 'never'
): void {
  container.textContent = '';
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = getMessage('optionsListEmpty');
    container.append(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = entry;
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = getMessage('optionsRemoveRule', entry);
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      settings = await send<Settings>({ type: 'remove-rule', list, pattern: entry });
      render();
      toast(getMessage('optionsRemoved'));
    });
    li.append(label, remove);
    container.append(li);
  }
}

function renderDomainSets(diagnostics: Diagnostics | null): void {
  const host = $('domainSets');
  host.textContent = '';
  for (const [id, enabled] of Object.entries(settings.domainSets)) {
    const wrapper = document.createElement('div');
    wrapper.className = 'set';

    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabled;
    input.addEventListener('change', () => {
      void patch({ domainSets: { [id]: input.checked } });
    });
    const text = document.createElement('span');
    const title = document.createElement('h3');
    title.textContent = getMessage(SET_TITLES[id] ?? 'optionsListEmpty');
    const desc = document.createElement('p');
    desc.textContent = getMessage(SET_DESCRIPTIONS[id] ?? 'optionsListEmpty');
    text.append(title, desc);
    label.append(input, text);
    wrapper.append(label);

    if (diagnostics !== null && id === 'google') {
      const count = document.createElement('p');
      count.className = 'count';
      count.textContent = getMessage('optionsHostCount', diagnostics.domainCount.toLocaleString());
      wrapper.append(count);
    }
    host.append(wrapper);
  }
}

const SET_TITLES: Record<string, string> = {
  google: 'setTitleGoogle',
  youtube: 'setTitleYoutube',
  trackers: 'setTitleTrackers',
  hosting: 'setTitleHosting',
};

const SET_DESCRIPTIONS: Record<string, string> = {
  google: 'setDescGoogle',
  youtube: 'setDescYoutube',
  trackers: 'setDescTrackers',
  hosting: 'setDescHosting',
};

function renderBlockAllowList(): void {
  const host = $('blockAllowList');
  host.textContent = '';
  if (settings.blocking.allowlist.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = getMessage('optionsNoSites');
    host.append(li);
    return;
  }
  for (const entry of settings.blocking.allowlist) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = entry;
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = getMessage('optionsRemoveRule', entry);
    remove.textContent = 'x';
    remove.addEventListener('click', async () => {
      settings = await send<Settings>({ type: 'allowlist-site', host: entry, allow: false });
      render();
      toast(getMessage('optionsRemoved'));
    });
    li.append(label, remove);
    host.append(li);
  }
}

/** Replace one exception in the current settings, returning the next list. */
function withException(
  pattern: string,
  patch: Partial<Pick<ExceptionRule, 'note' | 'enabled'>>
): ExceptionRule[] {
  return settings.exceptions.map((rule) =>
    rule.pattern === pattern ? { ...rule, ...patch } : rule
  );
}

async function saveExceptions(next: ExceptionRule[]): Promise<void> {
  settings = await send<Settings>({ type: 'set-exceptions', exceptions: next });
  render();
}

function renderExceptions(): void {
  const host = $('exceptionList');
  host.textContent = '';
  if (settings.exceptions.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = getMessage('optionsNoExceptions');
    host.append(li);
    return;
  }
  for (const rule of settings.exceptions) {
    const li = document.createElement('li');
    li.className = 'exception-row';
    if (!rule.enabled) li.classList.add('disabled');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled;
    toggle.title = getMessage(
      rule.enabled ? 'optionsExceptionEnabledTitle' : 'optionsExceptionDisabledTitle'
    );
    toggle.addEventListener('change', () => {
      void saveExceptions(withException(rule.pattern, { enabled: toggle.checked })).catch((error) =>
        toast(
          getMessage(
            'optionsExceptionUpdateFailed',
            error instanceof Error ? error.message : String(error)
          )
        )
      );
    });

    const pattern = document.createElement('span');
    pattern.className = 'pattern';
    pattern.textContent = rule.pattern;
    pattern.title = getMessage(
      'optionsExceptionAddedDate',
      new Date(rule.created).toLocaleDateString()
    );

    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'note';
    note.maxLength = 200;
    note.value = rule.note ?? '';
    note.placeholder = getMessage('optionsExceptionNotePlaceholder');
    note.title = getMessage('optionsExceptionNoteTitle');
    note.addEventListener('change', () => {
      const value = note.value.trim().slice(0, 200);
      void saveExceptions(withException(rule.pattern, { note: value === '' ? undefined : value }))
        .then(() => {
          note.value = value;
          toast(getMessage('optionsNoteSaved'));
        })
        .catch((error) => {
          note.value = rule.note ?? '';
          toast(
            getMessage(
              'optionsNoteSaveFailed',
              error instanceof Error ? error.message : String(error)
            )
          );
        });
    });

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = getMessage('optionsRemoveException', rule.pattern);
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      try {
        await saveExceptions(settings.exceptions.filter((r) => r.pattern !== rule.pattern));
        toast(getMessage('optionsExceptionRemoved'));
      } catch (error) {
        toast(
          getMessage(
            'optionsExceptionRemoveFailed',
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    });

    li.append(toggle, pattern, note, remove);
    host.append(li);
  }
}

function renderStats(): void {
  const s = settings.statistics;
  const items: Array<[string, string]> = [
    [getMessage('optionsStatContained'), s.containedNavigations.toLocaleString()],
    [getMessage('optionsStatReleased'), s.releasedNavigations.toLocaleString()],
    [getMessage('optionsStatUnwrapped'), s.unwrappedLinks.toLocaleString()],
    [getMessage('optionsStatExceptions'), s.exceptionsApplied.toLocaleString()],
    [getMessage('optionsStatTrackers'), s.trackersBlocked.toLocaleString()],
    [getMessage('optionsStatSince'), new Date(s.since).toLocaleDateString()],
    [
      getMessage('optionsStatLastEvent'),
      s.lastEvent === 0 ? getMessage('optionsStatNever') : new Date(s.lastEvent).toLocaleString(),
    ],
  ];
  const host = $('stats');
  host.textContent = '';
  for (const [label, value] of items) {
    const div = document.createElement('div');
    div.className = 'stat';
    const b = document.createElement('b');
    b.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    div.append(b, span);
    host.append(div);
  }
}

function render(): void {
  ($('enabled') as HTMLInputElement).checked = settings.enabled;
  const paused = settings.pausedUntil > Date.now();
  $('pauseState').textContent = paused
    ? getMessage('optionsPausedUntil', new Date(settings.pausedUntil).toLocaleTimeString())
    : getMessage('optionsRunning');

  ($('containerName') as HTMLInputElement).value = settings.container.name;
  fillSelect($('containerColor') as HTMLSelectElement, CONTAINER_COLORS, settings.container.color);
  fillSelect($('containerIcon') as HTMLSelectElement, CONTAINER_ICONS, settings.container.icon);

  for (const key of Object.keys(settings.behaviour) as Array<keyof Settings['behaviour']>) {
    const input = document.getElementById(key) as HTMLInputElement | null;
    if (input !== null) input.checked = settings.behaviour[key];
  }

  for (const mode of ['off', 'standard', 'strict'] as const) {
    const id = `block${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input !== null) input.checked = settings.blocking.mode === mode;
  }
  ($('showBadge') as HTMLInputElement).checked = settings.blocking.showBadge;
  renderBlockAllowList();

  renderDomainSets(null);
  renderList($('alwaysList'), settings.alwaysContainerize, 'always');
  renderList($('neverList'), settings.neverContainerize, 'never');
  renderExceptions();
  renderStats();
}

// -------------------------------------------------------------------- wiring

function wireTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('active');
      for (const panel of document.querySelectorAll('.panel')) panel.classList.remove('active');
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset['panel']}`)?.classList.add('active');
      if (tab.dataset['panel'] === 'diagnostics') void refreshDiagnostics();
    });
  }
}

const KIND_LABELS: Record<DecisionEntry['kind'], string> = {
  contain: 'optionsLogKindContain',
  release: 'optionsLogKindRelease',
  unwrap: 'optionsLogKindUnwrap',
  ignore: 'optionsLogKindIgnore',
};

function renderDecisionLog(entries: readonly DecisionEntry[]): void {
  const body = $('logBody');
  body.textContent = '';
  $('logCount').textContent = getMessage('optionsLogCount', String(entries.length));
  if (entries.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = getMessage('optionsLogEmpty');
    row.append(cell);
    body.append(row);
    return;
  }
  // Newest first: the log is stored oldest-first, so walk it backwards.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const row = document.createElement('tr');
    const when = document.createElement('td');
    when.textContent = new Date(entry.at).toLocaleTimeString();
    const kind = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${entry.kind}`;
    badge.textContent = getMessage(KIND_LABELS[entry.kind]);
    kind.append(badge);
    const reason = document.createElement('td');
    reason.textContent = entry.reason;
    const site = document.createElement('td');
    site.textContent = entry.host ?? getMessage('optionsStatNever');
    const url = document.createElement('td');
    url.className = 'url';
    url.textContent = entry.url;
    url.title = entry.url;
    row.append(when, kind, reason, site, url);
    body.append(row);
  }
}

async function refreshDiagnostics(): Promise<void> {
  try {
    const diagnostics = await send<Diagnostics>({ type: 'diagnostics' });
    // The decision log has its own table; keep the JSON dump about state.
    const { recentDecisions, ...rest } = diagnostics;
    $('diagnostics').textContent = JSON.stringify(rest, null, 2);
    renderDecisionLog(recentDecisions);
    renderDomainSets(diagnostics);
  } catch (error) {
    $('diagnostics').textContent = getMessage(
      'optionsDiagUnavailable',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function wireGeneral(): void {
  ($('enabled') as HTMLInputElement).addEventListener('change', (event) => {
    void patch({ enabled: (event.target as HTMLInputElement).checked });
  });
  $('pause30').addEventListener('click', async () => {
    settings = await send<Settings>({ type: 'pause', minutes: 30 });
    render();
    toast(getMessage('optionsPaused30'));
  });
  $('resume').addEventListener('click', async () => {
    settings = await send<Settings>({ type: 'resume' });
    render();
    toast(getMessage('optionsResumed'));
  });

  const name = $('containerName') as HTMLInputElement;
  name.addEventListener('change', () => {
    void patch({ container: { name: name.value } });
  });
  for (const key of ['containerColor', 'containerIcon'] as const) {
    const select = $(key) as HTMLSelectElement;
    select.addEventListener('change', () => {
      const field = key === 'containerColor' ? 'color' : 'icon';
      void patch({ container: { [field]: select.value } });
    });
  }

  for (const mode of ['off', 'standard', 'strict'] as const) {
    const id = `block${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
    const input = document.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener('change', () => {
      if (input.checked) void patch({ blocking: { mode } });
    });
  }
  ($('showBadge') as HTMLInputElement).addEventListener('change', (event) => {
    void patch({ blocking: { showBadge: (event.target as HTMLInputElement).checked } });
  });

  const blockInput = $('blockAllowInput') as HTMLInputElement;
  const addBlockAllow = async (): Promise<void> => {
    const value = blockInput.value.trim();
    if (value === '') return;
    try {
      settings = await send<Settings>({ type: 'allowlist-site', host: value, allow: true });
      blockInput.value = '';
      render();
      toast(getMessage('optionsSiteAdded'));
    } catch (error) {
      toast(getMessage('optionsAddFailed', error instanceof Error ? error.message : String(error)));
    }
  };
  $('blockAllowAdd').addEventListener('click', () => void addBlockAllow());
  blockInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addBlockAllow();
  });

  for (const key of [
    'unwrapRedirectors',
    'oauthPassthrough',
    'releaseNonGoogle',
    'handlePrivateWindows',
    'collectStatistics',
    'useSync',
  ] as const) {
    ($(key) as HTMLInputElement).addEventListener('change', (event) => {
      void patch({ behaviour: { [key]: (event.target as HTMLInputElement).checked } });
    });
  }
}

function wireRules(): void {
  /** Split pasted text into deduped, trimmed patterns (newlines, commas, semicolons). */
  const splitPatterns = (value: string): string[] => {
    const seen = new Set<string>();
    const patterns: string[] = [];
    for (const raw of value.split(/[\r\n,;]+/)) {
      const pattern = raw.trim();
      if (pattern === '' || seen.has(pattern)) continue;
      seen.add(pattern);
      patterns.push(pattern);
    }
    return patterns;
  };

  const autogrow = (input: HTMLTextAreaElement): void => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  };

  const add = async (list: 'always' | 'never', input: HTMLTextAreaElement): Promise<void> => {
    const patterns = splitPatterns(input.value);
    if (patterns.length === 0) return;
    try {
      const result = await send<AddRulesResult>({ type: 'add-rules', list, patterns });
      settings = result.settings;
      input.value = '';
      input.style.height = '';
      render();
      if (patterns.length === 1 && result.invalid.length === 1) {
        toast(getMessage('optionsRuleAddFailed', result.invalid[0]));
      } else if (patterns.length === 1) {
        toast(getMessage('optionsRuleAdded'));
      } else if (result.invalid.length > 0) {
        toast(
          `${getMessage('optionsRulesAdded', String(patterns.length - result.invalid.length))} ${getMessage(
            'optionsRulesSkipped',
            [String(result.invalid.length), result.invalid.slice(0, 3).join(', ')]
          )}`
        );
      } else {
        toast(getMessage('optionsRulesAdded', String(patterns.length)));
      }
    } catch (error) {
      toast(
        getMessage('optionsRuleAddFailed', String(error instanceof Error ? error.message : error))
      );
    }
  };

  const alwaysInput = $('alwaysInput') as HTMLTextAreaElement;
  const neverInput = $('neverInput') as HTMLTextAreaElement;
  $('alwaysAdd').addEventListener('click', () => void add('always', alwaysInput));
  $('neverAdd').addEventListener('click', () => void add('never', neverInput));
  for (const input of [alwaysInput, neverInput]) {
    input.addEventListener('input', () => autogrow(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void add(input === alwaysInput ? 'always' : 'never', input);
      }
    });
  }

  const exceptionInput = $('exceptionInput') as HTMLInputElement;
  const exceptionNote = $('exceptionNote') as HTMLInputElement;
  const addException = async (): Promise<void> => {
    const pattern = exceptionInput.value.trim();
    if (pattern === '') return;
    const note = exceptionNote.value.trim().slice(0, 200);
    try {
      await saveExceptions([
        ...settings.exceptions,
        {
          pattern,
          note: note === '' ? undefined : note,
          enabled: true,
          created: Date.now(),
        },
      ]);
      exceptionInput.value = '';
      exceptionNote.value = '';
      toast(getMessage('optionsExceptionAdded'));
    } catch (error) {
      toast(
        getMessage(
          'optionsExceptionAddFailed',
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  };
  $('exceptionAdd').addEventListener('click', () => void addException());
  exceptionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addException();
  });
}

function wireData(): void {
  $('export').addEventListener('click', async () => {
    const backup = await send<BackupDocument>({ type: 'export' });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orbis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(getMessage('optionsBackupExported'));
  });

  const file = $('importFile') as HTMLInputElement;
  $('importBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    try {
      const parsed: unknown = JSON.parse(await chosen.text());
      settings = await send<Settings>({ type: 'import', document: parsed });
      render();
      toast(getMessage('optionsSettingsImported'));
    } catch (error) {
      toast(
        getMessage('optionsImportFailed', error instanceof Error ? error.message : String(error))
      );
    } finally {
      file.value = '';
    }
  });

  $('reset').addEventListener('click', async () => {
    if (!window.confirm(getMessage('optionsResetConfirm'))) return;
    settings = await send<Settings>({ type: 'reset' });
    render();
    toast(getMessage('optionsSettingsReset'));
  });
}

function wireDiagnostics(): void {
  $('refreshDiag').addEventListener('click', () => void refreshDiagnostics());
  $('clearLog').addEventListener('click', async () => {
    try {
      const size = await send<number>({ type: 'clear-decision-log' });
      await refreshDiagnostics();
      toast(size === 0 ? getMessage('optionsLogAlreadyEmpty') : getMessage('optionsLogCleared'));
    } catch (error) {
      toast(
        getMessage('optionsLogClearFailed', error instanceof Error ? error.message : String(error))
      );
    }
  });
  const input = $('testInput') as HTMLInputElement;
  const run = async (): Promise<void> => {
    const value = input.value.trim();
    if (value === '') return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const result = await send<MatchResult>({ type: 'match-url', url });
    const detail = `${result.source}${result.pattern ? ` (${result.pattern})` : ''}`;
    $('testResult').textContent = result.isGoogle
      ? getMessage('optionsTestContained', detail)
      : getMessage('optionsTestNormal', detail);
  };
  $('testBtn').addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void run();
  });
}

async function main(): Promise<void> {
  localizePage();
  settings = await send<Settings>({ type: 'get-settings' });
  wireTabs();
  wireGeneral();
  wireRules();
  wireData();
  wireDiagnostics();
  render();
}

void main();
