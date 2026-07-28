/**
 * Popup controller.
 *
 * The popup owns no state: it asks the background worker for a `RuntimeState`
 * snapshot, renders it, and sends messages back. That keeps a single source of
 * truth and avoids the popup and background disagreeing after a settings change.
 */

import type { Message, RuntimeState } from '../types/index.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
};

async function send<T>(message: Message): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

function describeMatch(state: RuntimeState): string {
  if (state.currentHost === null) return 'No page loaded.';
  if (state.currentMatch.isGoogle) {
    return state.currentTabInContainer
      ? `Protected — isolated in ${state.containerName}.`
      : `Google site detected (${state.currentMatch.source}).`;
  }
  return state.currentTabInContainer
    ? 'Non-Google site currently inside the container.'
    : 'Not a Google site — browsing normally.';
}

async function render(): Promise<void> {
  const state = await send<RuntimeState>({ type: 'get-state' });
  const active = state.enabled && !state.paused;

  $('statusDot').classList.toggle('off', !active);
  $('statusText').textContent = active ? 'Active' : state.paused ? 'Paused' : 'Disabled';
  $('containerName').textContent = state.containerName;
  $('host').textContent = state.currentHost ?? '—';
  $('tabState').textContent = state.currentTabInContainer ? 'In container' : 'Normal browsing';

  const verdict = $('verdict');
  verdict.textContent = describeMatch(state);
  verdict.className = `verdict ${state.currentTabInContainer ? 'contained' : 'outside'}`;

  $('statContained').textContent = String(state.statistics.containedNavigations);
  $('statReleased').textContent = String(state.statistics.releasedNavigations);
  $('statDomains').textContent = state.domainCount.toLocaleString();

  ($('moveIn') as HTMLButtonElement).disabled =
    state.currentTabInContainer || state.currentUrl === null;
  ($('moveOut') as HTMLButtonElement).disabled =
    !state.currentTabInContainer || state.currentUrl === null;
  ($('always') as HTMLButtonElement).disabled = state.currentHost === null;
  ($('never') as HTMLButtonElement).disabled = state.currentHost === null;

  $('pause').classList.toggle('hidden', state.paused);
  $('resume').classList.toggle('hidden', !state.paused);
}

async function currentTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === 'number' ? tab.id : null;
}

async function currentHost(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.url !== 'string') return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
}

function wire(): void {
  $('openOptions').addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  $('moveIn').addEventListener('click', async () => {
    const tabId = await currentTabId();
    if (tabId !== null) await send({ type: 'move-tab', tabId, into: true });
    window.close();
  });

  $('moveOut').addEventListener('click', async () => {
    const tabId = await currentTabId();
    if (tabId !== null) await send({ type: 'move-tab', tabId, into: false });
    window.close();
  });

  $('always').addEventListener('click', async () => {
    const host = await currentHost();
    if (host !== null) await send({ type: 'add-rule', list: 'always', pattern: host });
    await render();
  });

  $('never').addEventListener('click', async () => {
    const host = await currentHost();
    if (host !== null) await send({ type: 'add-rule', list: 'never', pattern: host });
    await render();
  });

  $('pause').addEventListener('click', async () => {
    await send({ type: 'pause', minutes: 30 });
    await render();
  });

  $('resume').addEventListener('click', async () => {
    await send({ type: 'resume' });
    await render();
  });
}

wire();
void render();
