import { getMessage, localizePage } from '../shared/i18n.js';

let currentStep = 1;
const totalSteps = 4;

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing onboarding element: ${selector}`);
  return el;
}

function updateProgress(): void {
  const fill = element<HTMLElement>('#progress-fill');
  const bar = element<HTMLElement>('.progress-bar');
  const text = element<HTMLElement>('#progress-text');
  const percent = (currentStep / totalSteps) * 100;
  fill.style.width = `${percent}%`;
  bar.setAttribute('aria-valuenow', String(currentStep));
  text.textContent = getMessage('onboardingStepCount', [String(currentStep), String(totalSteps)]);
  document.querySelectorAll<HTMLElement>('.dot').forEach((dot) => {
    const step = Number(dot.dataset['step']);
    dot.classList.toggle('active', step === currentStep);
  });
  const prev = element<HTMLButtonElement>('#prev-step');
  const next = element<HTMLButtonElement>('#next-step');
  prev.disabled = currentStep === 1;
  next.textContent =
    currentStep === totalSteps ? getMessage('onboardingDone') : getMessage('onboardingNext');
}

function showStep(step: number): void {
  document.querySelectorAll<HTMLElement>('.onboarding-step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset['step']) === step);
  });
  currentStep = step;
  updateProgress();
  // Move focus to the step heading so keyboard and screen-reader users land
  // on the new content instead of being stranded on the previous step.
  document.querySelector<HTMLElement>(`.onboarding-step.active h2`)?.focus({ preventScroll: true });
}

function bind(): void {
  element<HTMLButtonElement>('#prev-step').addEventListener('click', () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });
  element<HTMLButtonElement>('#next-step').addEventListener('click', () => {
    if (currentStep < totalSteps) {
      showStep(currentStep + 1);
    } else {
      void browser.storage.local.set({ onboardingCompleted: true }).then(() => window.close());
    }
  });
  element<HTMLButtonElement>('#try-orbis').addEventListener('click', () => {
    void browser.tabs
      .create({ url: 'https://www.google.com' })
      .then(() => browser.storage.local.set({ onboardingCompleted: true }))
      .then(() => window.close())
      .catch(() => {
        window.location.href = '../options/options.html';
      });
  });
  element<HTMLButtonElement>('#open-dashboard').addEventListener('click', () => {
    void browser.storage.local.set({ onboardingCompleted: true }).then(() => {
      window.location.href = '../options/options.html';
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      if (currentStep < totalSteps) showStep(currentStep + 1);
    } else if (event.key === 'ArrowLeft') {
      if (currentStep > 1) showStep(currentStep - 1);
    } else if (event.key === 'Escape') {
      void browser.storage.local.set({ onboardingCompleted: true }).then(() => window.close());
    }
  });
}

localizePage();

try {
  bind();
  updateProgress();
} catch (error) {
  console.error('[orbis] Onboarding failed', error);
}
