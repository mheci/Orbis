let currentStep = 1;
const totalSteps = 4;

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing onboarding element: ${selector}`);
  return el;
}

function updateProgress(): void {
  const fill = element<HTMLElement>('#progress-fill');
  const text = element<HTMLElement>('#progress-text');
  const percent = (currentStep / totalSteps) * 100;
  fill.style.width = `${percent}%`;
  text.textContent = `Step ${currentStep} of ${totalSteps}`;
  document.querySelectorAll<HTMLElement>('.dot').forEach((dot) => {
    const step = Number(dot.dataset['step']);
    dot.classList.toggle('active', step === currentStep);
  });
  const prev = element<HTMLButtonElement>('#prev-step');
  const next = element<HTMLButtonElement>('#next-step');
  prev.disabled = currentStep === 1;
  next.textContent = currentStep === totalSteps ? 'Done' : 'Next';
}

function showStep(step: number): void {
  document.querySelectorAll<HTMLElement>('.onboarding-step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset['step']) === step);
  });
  currentStep = step;
  updateProgress();
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

try {
  bind();
  updateProgress();
} catch (error) {
  console.error('[orbis] Onboarding failed', error);
}
