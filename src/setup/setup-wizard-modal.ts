import type { App } from 'obsidian';
import { Modal, Platform, setIcon } from 'obsidian';
import { ManageModelsModal } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import { openFilteredHotkeySettings } from '../settings/open-hotkey-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import type { SidecarInstallManager } from '../sidecar/sidecar-install-manager';
import { SetupReadyActions } from './setup-ready-actions';
import { getInstallCopy } from './sidecar-install-copy';
import { SidecarInstallModal } from './sidecar-install-modal';

interface WizardDependencies {
  app: App;
  feedback: Pick<UserFeedback, 'show'>;
  hasDictationTarget: () => boolean;
  hasSelectedModel: () => boolean;
  isDictationBusy: () => boolean;
  isSidecarInstalled: () => Promise<boolean>;
  logger?: PluginLogger;
  modelInstallManager: ModelInstallManager;
  onCompleted: () => Promise<void>;
  pluginDirectory: string;
  postSidecarInstalled: () => Promise<void>;
  pluginVersion: string;
  sidecarConnection: Pick<SidecarConnection, 'restart'>;
  sidecarInstallManager: SidecarInstallManager;
  sidecarStartupTimeoutMs: number;
  startDictation: () => Promise<void>;
}

type WizardStepId = 'sidecar' | 'model' | 'ready';

const STEP_ORDER: readonly WizardStepId[] = ['sidecar', 'model', 'ready'];

export class SetupWizardModal extends Modal {
  private currentStep: WizardStepId = 'sidecar';
  private sidecarReady = false;
  private modelReady = false;
  private modelManagerUnsub: (() => void) | null = null;
  private openGeneration = 0;
  private readonly readyActions: SetupReadyActions;

  constructor(private readonly deps: WizardDependencies) {
    super(deps.app);
    this.readyActions = new SetupReadyActions({
      closeWizard: () => this.close(),
      feedback: deps.feedback,
      hasDictationTarget: deps.hasDictationTarget,
      isDictationBusy: deps.isDictationBusy,
      onCompleted: deps.onCompleted,
      startDictation: deps.startDictation,
    });
  }

  override onOpen(): void {
    const generation = ++this.openGeneration;
    void this.openAsync(generation);
  }

  private async openAsync(generation: number): Promise<void> {
    this.modalEl.addClass('local-stt-setup-wizard');
    this.sidecarReady = await this.deps.isSidecarInstalled();
    if (generation !== this.openGeneration) {
      return;
    }
    this.modelReady = this.deps.hasSelectedModel();

    if (!this.sidecarReady) {
      this.currentStep = 'sidecar';
    } else if (!this.modelReady) {
      this.currentStep = 'model';
    } else {
      this.currentStep = 'ready';
    }

    this.modelManagerUnsub = this.deps.modelInstallManager.subscribe(() => {
      const next = this.deps.hasSelectedModel();
      if (next !== this.modelReady) {
        this.modelReady = next;
        if (this.currentStep === 'model') {
          this.render();
        }
      }
    });

    this.render();
  }

  override onClose(): void {
    // Invalidate a prerequisite check that may still be awaiting the filesystem.
    // Without this guard, its continuation can subscribe and render after close.
    this.openGeneration += 1;
    this.modelManagerUnsub?.();
    this.modelManagerUnsub = null;
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    const isWelcome = this.currentStep === 'sidecar' && !this.sidecarReady;
    this.setTitle(isWelcome ? t('setup.wizard.welcomeTitle') : t('setup.wizard.title'));

    this.renderProgress();

    switch (this.currentStep) {
      case 'sidecar':
        this.renderSidecarStep();
        break;
      case 'model':
        this.renderModelStep();
        break;
      case 'ready':
        this.renderReadyStep();
        break;
    }
  }

  private renderProgress(): void {
    const bar = this.contentEl.createDiv({ cls: 'local-stt-wizard-progress' });
    STEP_ORDER.forEach((step, index) => {
      const dot = bar.createDiv({
        cls: 'local-stt-wizard-progress__dot',
      });
      if (step === this.currentStep) {
        dot.addClass('is-active');
      }
      if (this.isStepComplete(step)) {
        dot.addClass('is-complete');
      }
      dot.setText(String(index + 1));
    });
  }

  private isStepComplete(step: WizardStepId): boolean {
    if (step === 'sidecar') return this.sidecarReady;
    if (step === 'model') return this.modelReady;
    return false;
  }

  // ---------------- Step 1: Sidecar ----------------
  private renderSidecarStep(): void {
    const body = this.contentEl.createDiv({ cls: 'local-stt-wizard-step' });

    if (this.sidecarReady) {
      body.createEl('h2', {
        cls: 'local-stt-wizard-step__title',
        text: t('setup.wizard.engineReadyTitle'),
      });
      body.createEl('p', {
        text: t('setup.wizard.engineReadyDesc'),
      });
    } else {
      body.createEl('p', {
        text: t('setup.wizard.intro'),
      });

      body.createEl('p', { text: t('setup.wizard.quickSetup') });
      const steps = body.createEl('ol');
      steps.createEl('li', { text: t('setup.wizard.downloadEngineStep') });
      steps.createEl('li', { text: t('setup.wizard.pickModelStep') });

      body.createEl('p', {
        text: t('setup.wizard.startTalking'),
      });

      if (!Platform.isMacOS) {
        body.createEl('p', {
          cls: 'local-stt-wizard-step__muted',
          text: t('setup.wizard.cpuBuildNote'),
        });
      }
    }

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => {
      this.close();
    });

    if (this.sidecarReady) {
      const next = actions.createEl('button', {
        cls: 'mod-cta',
        text: t('common.next'),
      });
      next.addEventListener('click', () => this.goNext());
    } else {
      const installBtn = actions.createEl('button', {
        cls: 'mod-cta',
        text: t('setup.wizard.downloadEngine'),
      });
      installBtn.addEventListener('click', () => this.openSidecarInstall());
    }
  }

  private openSidecarInstall(): void {
    const modal = new SidecarInstallModal(this.deps.app, {
      copy: getInstallCopy('cpu', 'first-run'),
      feedback: this.deps.feedback,
      manager: this.deps.sidecarInstallManager,
      onInstalled: async () => {
        await this.deps.postSidecarInstalled();
        this.sidecarReady = true;
        this.goNext();
      },
      pluginDirectory: this.deps.pluginDirectory,
      variants: ['cpu'],
      version: this.deps.pluginVersion,
    });
    modal.open();
  }

  // ---------------- Step 2: Model ----------------
  private renderModelStep(): void {
    const body = this.contentEl.createDiv({ cls: 'local-stt-wizard-step' });
    body.createEl('h2', {
      cls: 'local-stt-wizard-step__title',
      text: this.modelReady
        ? t('setup.wizard.modelSelectedTitle')
        : t('setup.wizard.pickModelTitle'),
    });
    if (this.modelReady) {
      body.createEl('p', {
        text: t('setup.wizard.modelSelectedDesc'),
      });
    } else {
      body.createEl('p', {
        text: t('setup.wizard.modelIntro'),
      });
      body.createEl('p', {
        text: t('setup.wizard.modelKinds'),
      });
      if (!Platform.isMacOS) {
        body.createEl('p', {
          cls: 'local-stt-wizard-step__muted',
          text: t('setup.wizard.gpuNote'),
        });
      }
    }

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions
      .createEl('button', { text: t('common.back') })
      .addEventListener('click', () => this.goBack());

    if (this.modelReady) {
      const next = actions.createEl('button', { cls: 'mod-cta', text: t('common.next') });
      next.addEventListener('click', () => this.goNext());
    } else {
      const openPicker = actions.createEl('button', {
        cls: 'mod-cta',
        text: t('setup.wizard.openModelPicker'),
      });
      openPicker.addEventListener('click', () => this.openModelPicker());
    }
  }

  private openModelPicker(): void {
    const modal = new ManageModelsModal(this.deps.app, {
      feedback: this.deps.feedback,
      initialTask: 'stt',
      manager: this.deps.modelInstallManager,
      onChanged: () => {
        // Re-check on any change so the wizard advances as soon as a model is selected.
        this.modelReady = this.deps.hasSelectedModel();
        if (this.modelReady) {
          this.render();
        }
      },
    });
    modal.open();
  }

  // ---------------- Step 3: Ready ----------------
  private renderReadyStep(): void {
    const body = this.contentEl.createDiv({ cls: 'local-stt-wizard-step' });
    body.createEl('h2', {
      cls: 'local-stt-wizard-step__title',
      text: t('setup.wizard.readyTitle'),
    });
    body.createEl('p', {
      text: t('setup.wizard.readyDesc'),
    });

    const cardRibbon = body.createDiv({ cls: 'local-stt-wizard-card' });
    const ribbonIcon = cardRibbon.createSpan({ cls: 'local-stt-wizard-card__icon' });
    setIcon(ribbonIcon, 'mic');
    const ribbonText = cardRibbon.createDiv({ cls: 'local-stt-wizard-card__text' });
    ribbonText.createEl('strong', { text: t('setup.wizard.ribbonTitle') });
    ribbonText.createEl('p', {
      text: t('setup.wizard.ribbonDesc'),
    });

    const cardHotkey = body.createDiv({ cls: 'local-stt-wizard-card' });
    const hotkeyIcon = cardHotkey.createSpan({ cls: 'local-stt-wizard-card__icon' });
    setIcon(hotkeyIcon, 'keyboard');
    const hotkeyText = cardHotkey.createDiv({ cls: 'local-stt-wizard-card__text' });
    hotkeyText.createEl('strong', { text: t('setup.wizard.hotkeyTitle') });
    const hotkeyDesc = hotkeyText.createEl('p');
    hotkeyDesc.appendText(t('setup.wizard.hotkeyDescBefore'));
    hotkeyDesc.createEl('strong', { text: t('setup.wizard.toggleCommandName') });
    hotkeyDesc.appendText(t('setup.wizard.hotkeyDescAfter'));
    const hotkeyBtn = cardHotkey.createEl('button', {
      text: t('setup.wizard.openHotkeySettings'),
    });
    hotkeyBtn.addEventListener('click', () => this.openHotkeySettings());

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions
      .createEl('button', { text: t('common.back') })
      .addEventListener('click', () => this.goBack());
    const done = actions.createEl('button', { text: t('common.done') });
    done.addEventListener('click', () => {
      void this.readyActions.done();
    });
    const tryDictation = actions.createEl('button', {
      cls: 'mod-cta',
      text: t('setup.wizard.tryDictationNow'),
    });
    tryDictation.addEventListener('click', () => {
      void this.readyActions.tryDictationNow();
    });
  }

  private openHotkeySettings(): void {
    openFilteredHotkeySettings(this.deps.app, 'Speech Kit', (error) => {
      this.deps.feedback.show({
        cause: error,
        intent: 'warning',
        message: t('setup.wizard.openHotkeySettingsFallback'),
      });
    });
  }

  // ---------------- Navigation ----------------
  private goNext(): void {
    const idx = STEP_ORDER.indexOf(this.currentStep);
    if (idx < 0) return;
    const next = STEP_ORDER[idx + 1];
    if (next !== undefined) {
      this.currentStep = next;
      this.render();
    }
  }

  private goBack(): void {
    const idx = STEP_ORDER.indexOf(this.currentStep);
    if (idx <= 0) return;
    const prev = STEP_ORDER[idx - 1];
    if (prev !== undefined) {
      this.currentStep = prev;
      this.render();
    }
  }
}
