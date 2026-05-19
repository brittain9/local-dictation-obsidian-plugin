import type { App } from 'obsidian';
import { Modal, Notice, Platform, setIcon } from 'obsidian';

import type { ModelInstallManager } from '../models/model-install-manager';
import { ManageModelsModal } from '../models/manage-models-modal';
import type { PluginLogger } from '../shared/plugin-logger';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import type { SidecarInstallManager } from '../sidecar/sidecar-install-manager';
import { SidecarInstallModal } from './sidecar-install-modal';
import { getInstallCopy } from './sidecar-install-copy';

interface WizardDependencies {
  app: App;
  getInitialStep?: () => WizardStepId;
  hasSelectedModel: () => boolean;
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
}

type WizardStepId = 'sidecar' | 'model' | 'ready';

const STEP_ORDER: readonly WizardStepId[] = ['sidecar', 'model', 'ready'];

export class SetupWizardModal extends Modal {
  private currentStep: WizardStepId = 'sidecar';
  private sidecarReady = false;
  private modelReady = false;
  private modelManagerUnsub: (() => void) | null = null;

  constructor(private readonly deps: WizardDependencies) {
    super(deps.app);
  }

  override async onOpen(): Promise<void> {
    this.modalEl.addClass('local-stt-setup-wizard');
    this.sidecarReady = await this.deps.isSidecarInstalled();
    this.modelReady = this.deps.hasSelectedModel();

    const initial = this.deps.getInitialStep?.();
    if (initial !== undefined) {
      this.currentStep = initial;
    } else if (!this.sidecarReady) {
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
    this.modelManagerUnsub?.();
    this.modelManagerUnsub = null;
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText('Set up Local Dictation');

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
    body.createEl('h2', {
      cls: 'local-stt-wizard-step__title',
      text: this.sidecarReady ? 'Speech engine ready' : 'Install the speech engine',
    });

    if (this.sidecarReady) {
      body.createEl('p', {
        text: 'The local speech-to-text engine is installed and ready.',
      });
    } else {
      body.createEl('p', {
        text: Platform.isMacOS
          ? 'Local Dictation needs a one-time download of its speech-to-text engine. Transcription runs entirely on your Mac — audio never leaves your machine.'
          : 'Local Dictation needs a one-time download of its speech-to-text engine. Transcription runs locally on your machine after this completes.',
      });
      body.createEl('p', {
        cls: 'local-stt-wizard-step__muted',
        text: Platform.isMacOS
          ? 'Includes Metal acceleration on Apple Silicon and Intel Macs.'
          : 'CPU build first. You can install CUDA acceleration later in Settings → Advanced.',
      });
    }

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.close();
    });

    if (this.sidecarReady) {
      const next = actions.createEl('button', {
        cls: 'mod-cta',
        text: 'Next',
      });
      next.addEventListener('click', () => this.goNext());
    } else {
      const installBtn = actions.createEl('button', {
        cls: 'mod-cta',
        text: 'Download engine',
      });
      installBtn.addEventListener('click', () => this.openSidecarInstall());
    }
  }

  private openSidecarInstall(): void {
    const variant: 'cpu' | 'cuda' = 'cpu';
    const modal = new SidecarInstallModal(this.deps.app, {
      copy: getInstallCopy(variant, 'first-run'),
      manager: this.deps.sidecarInstallManager,
      onInstalled: async () => {
        await this.deps.postSidecarInstalled();
        this.sidecarReady = true;
        this.goNext();
      },
      pluginDirectory: this.deps.pluginDirectory,
      variant,
      version: this.deps.pluginVersion,
    });
    modal.open();
  }

  // ---------------- Step 2: Model ----------------
  private renderModelStep(): void {
    const body = this.contentEl.createDiv({ cls: 'local-stt-wizard-step' });
    body.createEl('h2', {
      cls: 'local-stt-wizard-step__title',
      text: this.modelReady ? 'Model selected' : 'Pick a transcription model',
    });

    if (this.modelReady) {
      body.createEl('p', {
        text: 'A transcription model is installed and selected. You can install more or switch later from Settings.',
      });
    } else {
      body.createEl('p', {
        text: 'Install a transcription model to enable dictation. You can install more later — smaller models are faster, larger models are more accurate.',
      });
    }

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions.createEl('button', { text: 'Back' }).addEventListener('click', () => this.goBack());

    if (this.modelReady) {
      const next = actions.createEl('button', { cls: 'mod-cta', text: 'Next' });
      next.addEventListener('click', () => this.goNext());
    } else {
      const openPicker = actions.createEl('button', {
        cls: 'mod-cta',
        text: 'Open model picker',
      });
      openPicker.addEventListener('click', () => this.openModelPicker());
    }
  }

  private openModelPicker(): void {
    const modal = new ManageModelsModal(this.deps.app, {
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
      text: "You're ready to dictate",
    });

    const cardRibbon = body.createDiv({ cls: 'local-stt-wizard-card' });
    const ribbonIcon = cardRibbon.createSpan({ cls: 'local-stt-wizard-card__icon' });
    setIcon(ribbonIcon, 'audio-lines');
    const ribbonText = cardRibbon.createDiv({ cls: 'local-stt-wizard-card__text' });
    ribbonText.createEl('strong', { text: 'Use the ribbon mic' });
    ribbonText.createEl('p', {
      text: 'Look for this icon in the Obsidian ribbon. Click it to start dictating; click again to stop.',
    });

    const cardHotkey = body.createDiv({ cls: 'local-stt-wizard-card' });
    const hotkeyIcon = cardHotkey.createSpan({ cls: 'local-stt-wizard-card__icon' });
    setIcon(hotkeyIcon, 'keyboard');
    const hotkeyText = cardHotkey.createDiv({ cls: 'local-stt-wizard-card__text' });
    hotkeyText.createEl('strong', { text: 'Or bind a hotkey' });
    hotkeyText.createEl('p', {
      text: 'Set a keyboard shortcut to toggle dictation from anywhere in Obsidian.',
    });
    const hotkeyBtn = cardHotkey.createEl('button', { text: 'Open hotkey settings' });
    hotkeyBtn.addEventListener('click', () => this.openHotkeySettings());

    const actions = this.contentEl.createDiv({ cls: 'local-stt-wizard-actions' });
    actions.createEl('button', { text: 'Back' }).addEventListener('click', () => this.goBack());
    const done = actions.createEl('button', { cls: 'mod-cta', text: 'Done' });
    done.addEventListener('click', async () => {
      await this.deps.onCompleted();
      this.close();
    });
  }

  private openHotkeySettings(): void {
    // Obsidian's documented setting-open API: opens the hotkeys tab and filters by command name.
    type SettingHost = {
      setting?: { open?: () => void; openTabById?: (id: string) => unknown };
    };
    type HotkeysTab = { searchInputEl?: HTMLInputElement; updateHotkeyVisibility?: () => void };
    const host = this.deps.app as unknown as SettingHost;
    try {
      host.setting?.open?.();
      const tab = host.setting?.openTabById?.('hotkeys') as HotkeysTab | undefined;
      if (tab !== undefined && tab.searchInputEl !== undefined) {
        tab.searchInputEl.value = 'Local Dictation';
        tab.searchInputEl.dispatchEvent(new Event('input'));
      }
    } catch (error) {
      this.deps.logger?.warn('setup', 'failed to open hotkey settings', error);
      new Notice('Open Settings → Hotkeys and search for "Local Dictation".');
    }
  }

  // ---------------- Navigation ----------------
  private goNext(): void {
    const idx = STEP_ORDER.indexOf(this.currentStep);
    if (idx >= 0 && idx < STEP_ORDER.length - 1) {
      this.currentStep = STEP_ORDER[idx + 1]!;
      this.render();
    }
  }

  private goBack(): void {
    const idx = STEP_ORDER.indexOf(this.currentStep);
    if (idx > 0) {
      this.currentStep = STEP_ORDER[idx - 1]!;
      this.render();
    }
  }
}
