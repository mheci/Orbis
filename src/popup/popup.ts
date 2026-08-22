/**
 * Popup controller.
 *
 * The popup owns no state: it asks the background worker for a `RuntimeState`
 * snapshot, renders it, and sends messages back. That keeps a single source of
 * truth and avoids the popup and background disagreeing after a settings change.
 */

import type { Message, RuntimeState } from '../types/index.js';
import { getMessage, localizePage } from '../shared/i18n.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
};

/**
 * Send a message to the background worker.
 *
 * The worker converts a thrown error into `{ error: string }` rather than
 * rejecting, so an unchecked caller would happily treat that object as a
 * `RuntimeState` and render `undefined` everywhere. Convert it back into a
 * rejection here so failures surface as a readable message instead of a blank
 * popup.
 */
async function send<T>(message: Message): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as T | { error: string };
  if (response !== null && typeof response === 'object' && 'error' in response) {
    throw new Error(String((response as { error: string }).error));
  }
  return response as T;
}

function describeMatch(state: RuntimeState): string {
  if (state.currentHost === null) return getMessage('popupNoPage');
  if (state.currentMatch.isGoogle) {
    return state.currentTabInContainer
      ? getMessage('popupVerdictProtected', state.containerName)
      : getMessage('popupVerdictGoogle', state.currentMatch.source);
  }
  return state.currentTabInContainer
    ? getMessage('popupVerdictInside')
    : getMessage('popupVerdictNormal');
}

/** Latest RuntimeState snapshot; every handler reads it instead of re-querying. */
let latestState: RuntimeState | null = null;

async function render(): Promise<void> {
  const state = await send<RuntimeState>({ type: 'get-state' });
  latestState = state;
  const active = state.enabled && !state.paused;

  $('statusDot').classList.toggle('off', !active);
  $('statusText').textContent = active
    ? getMessage('popupActive')
    : state.paused
      ? getMessage('popupPaused')
      : getMessage('popupDisabled');
  $('containerName').textContent = state.containerName;
  $('host').textContent = state.currentHost ?? '—';
  $('tabState').textContent = state.currentTabInContainer
    ? getMessage('popupInContainer')
    : getMessage('popupNormalBrowsing');

  const verdict = $('verdict');
  verdict.textContent = describeMatch(state);
  verdict.className = `verdict ${state.currentTabInContainer ? 'contained' : 'outside'}`;

  $('statContained').textContent = String(state.statistics.containedNavigations);
  $('statReleased').textContent = String(state.statistics.releasedNavigations);
  $('statBlocked').textContent = state.statistics.trackersBlocked.toLocaleString();

  $('blockedHere').textContent = String(state.blockedHere);
  const blockHint = $('blockHint');
  const allowButton = $('allowSite') as HTMLButtonElement;
  if (state.blockingMode === 'off') {
    blockHint.textContent = getMessage('popupBlockHintOff');
  } else if (state.siteAllowlisted) {
    blockHint.textContent = getMessage('popupBlockHintAllowed');
  } else if (state.blockedHere === 0) {
    blockHint.textContent = getMessage('popupBlockHintNone');
  } else {
    blockHint.textContent = getMessage('popupBlockedHint');
  }
  allowButton.textContent = state.siteAllowlisted
    ? getMessage('popupBlockAgain')
    : getMessage('popupAllowSite');
  allowButton.disabled = state.currentHost === null || state.blockingMode === 'off';

  ($('moveIn') as HTMLButtonElement).disabled =
    state.currentTabInContainer || state.currentUrl === null;
  ($('moveOut') as HTMLButtonElement).disabled =
    !state.currentTabInContainer || state.currentUrl === null;
  ($('always') as HTMLButtonElement).disabled = state.currentHost === null;
  ($('never') as HTMLButtonElement).disabled = state.currentHost === null;

  // Time-boxed allowance: the button flips between pausing and resuming
  // containment for this site, and the hint counts down while a window runs.
  const tempButton = $('tempAllow') as HTMLButtonElement;
  const tempHint = $('tempHint');
  const windowLive =
    typeof state.tempAllowedUntil === 'number' && state.tempAllowedUntil > Date.now();
  tempButton.disabled = state.currentHost === null;
  tempButton.textContent = windowLive
    ? getMessage('popupTempResume')
    : getMessage('popupTempAllow');
  if (windowLive) {
    tempHint.classList.remove('hidden');
    renderTempHint(state.tempAllowedUntil as number);
  } else {
    tempHint.classList.add('hidden');
    tempHint.textContent = '';
  }

  $('pause').classList.toggle('hidden', state.paused);
  $('resume').classList.toggle('hidden', !state.paused);
}

/** Countdown text for an active temporary allowance; ticks once per second. */
function renderTempHint(until: number): void {
  const remaining = Math.max(0, until - Date.now());
  const minutes = Math.ceil(remaining / 60_000);
  $('tempHint').textContent = getMessage('popupTempHint', String(minutes));
}

function wire(): void {
  $('openOptions').addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  // Tab facts (id, host) come from the state snapshot the background already
  // built; querying tabs again per click costs two extra round-trips and can
  // only ever disagree with what was just rendered.
  const move = async (into: boolean): Promise<void> => {
    const tabId = latestState?.currentTabId;
    if (typeof tabId === 'number') await send({ type: 'move-tab', tabId, into });
    window.close();
  };

  $('moveIn').addEventListener('click', () => void move(true));
  $('moveOut').addEventListener('click', () => void move(false));

  $('always').addEventListener('click', async () => {
    if (latestState?.currentHost) {
      await send({ type: 'add-rule', list: 'always', pattern: latestState.currentHost });
    }
    await safeRender();
  });

  $('never').addEventListener('click', async () => {
    if (latestState?.currentHost) {
      await send({ type: 'add-rule', list: 'never', pattern: latestState.currentHost });
    }
    await safeRender();
  });

  $('allowSite').addEventListener('click', async () => {
    const state = latestState;
    if (state?.currentHost === null || state?.currentHost === undefined) return;
    await send({
      type: 'allowlist-site',
      host: state.currentHost,
      allow: !state.siteAllowlisted,
    });
    // Blocking decisions are cached per page, so the change needs a reload.
    if (typeof state.currentTabId === 'number') await browser.tabs.reload(state.currentTabId);
    await safeRender();
  });

  $('tempAllow').addEventListener('click', async () => {
    const state = latestState;
    if (state?.currentHost === null || state?.currentHost === undefined) return;
    const windowLive =
      typeof state.tempAllowedUntil === 'number' && state.tempAllowedUntil > Date.now();
    await send(
      windowLive
        ? { type: 'remove-temporary-allow', host: state.currentHost }
        : { type: 'temporarily-allow', host: state.currentHost, minutes: 30 }
    );
    await safeRender();
  });

  $('pause').addEventListener('click', async () => {
    await send({ type: 'pause', minutes: 30 });
    await safeRender();
  });

  $('resume').addEventListener('click', async () => {
    await send({ type: 'resume' });
    await safeRender();
  });
}

/**
 * Render, and if the worker is unreachable show a readable message rather than
 * a silently blank popup. This happens in practice when the event page is being
 * restarted or the extension was just updated underneath an open popup.
 */
async function safeRender(): Promise<void> {
  try {
    await render();
  } catch (error) {
    const verdict = document.getElementById('verdict');
    const host = document.getElementById('host');
    if (host !== null) host.textContent = getMessage('popupStarting');
    if (verdict !== null) {
      verdict.className = 'verdict outside';
      verdict.textContent =
        error instanceof Error && error.message.length > 0
          ? getMessage('popupUnreachableDetail', error.message)
          : getMessage('popupUnreachable');
    }
    console.warn('[orbis] popup render failed', error);
  }
}

localizePage();
wire();
void safeRender();

// Keep the countdown hint live while the popup is open. Reading the snapshot
// only (no re-render) keeps a tick at string-assignment cost.
setInterval(() => {
  const until = latestState?.tempAllowedUntil ?? null;
  if (typeof until === 'number' && until > Date.now()) renderTempHint(until);
}, 1000);
