import type { App, Plugin } from 'obsidian';
import { Platform, PluginSettingTab, Setting } from 'obsidian';

import { resolveEngineCapabilities } from '../models/capability-view';
import { ManageModelsModal } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import { ExternalModelFileModal, ModelDetailsModal } from '../models/model-management-modals';
import { matchesModelTriple } from '../models/model-management-types';
import type { PluginLogger } from '../shared/plugin-logger';
import type { SpeakingStyle } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import { readInstallManifest, variantDirectoryPath } from '../sidecar/sidecar-installer';
import { renderActiveInstallCard } from './install-progress-row';
import { renderModelSection } from './model-settings-section';
import {
  type DictationAnchor,
  isDictationAnchor,
  isListeningMode,
  isSpeakingStyle,
  isTimestampClock,
  isTimestampDensity,
  isTranscriptFormattingMode,
  MAX_TIMESTAMP_SPARSE_INTERVAL_MS,
  MIN_TIMESTAMP_SPARSE_INTERVAL_MS,
  type PluginSettings,
  type TimestampClock,
  type TimestampDensity,
  type TranscriptFormattingMode,
} from './plugin-settings';
import {
  addEnumSetting,
  addTextSetting,
  addToggleSetting,
  appendInfoTooltip,
  createSettingGroup,
  type DropdownOption,
  type SettingAccess,
} from './setting-helpers';
import {
  openSidecarInstallModal,
  resolvePluginDirectorySafe,
  type SidecarInstallActionDeps,
  SidecarSettingsSection,
} from './sidecar-settings-section';

interface SettingsTabDependencies {
  getSettings: () => PluginSettings;
  isDictationBusy: () => boolean;
  logger?: PluginLogger | undefined;
  modelInstallManager: ModelInstallManager;
  pluginVersion: string;
  resolvePluginDirectory: () => Promise<string>;
  restartSidecar: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'shutdown'>;
  sidecarInstallManager: SidecarInstallManager;
}

const LISTENING_MODE_OPTIONS: ReadonlyArray<DropdownOption<'always_on' | 'one_sentence'>> = [
  { label: 'Always on', value: 'always_on' },
  { label: 'One sentence', value: 'one_sentence' },
];

const DICTATION_ANCHOR_OPTIONS: ReadonlyArray<DropdownOption<DictationAnchor>> = [
  { label: 'At cursor', value: 'at_cursor' },
  { label: 'End of note', value: 'end_of_note' },
];

const TRANSCRIPT_FORMATTING_OPTIONS: ReadonlyArray<DropdownOption<TranscriptFormattingMode>> = [
  { label: 'Smart paragraphs', value: 'smart' },
  { label: 'Space', value: 'space' },
  { label: 'New line', value: 'new_line' },
  { label: 'New paragraph', value: 'new_paragraph' },
];

const SPEAKING_STYLE_OPTIONS: ReadonlyArray<DropdownOption<SpeakingStyle>> = [
  { label: 'Responsive', value: 'responsive' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Patient', value: 'patient' },
];

const TIMESTAMP_CLOCK_OPTIONS: ReadonlyArray<DropdownOption<TimestampClock>> = [
  { label: 'Elapsed', value: 'elapsed' },
  { label: 'Wall clock', value: 'wallclock' },
];

const TIMESTAMP_DENSITY_OPTIONS: ReadonlyArray<DropdownOption<TimestampDensity>> = [
  { label: 'Sparse', value: 'sparse' },
  { label: 'Every phrase', value: 'every_utterance' },
];

export class LocalSttSettingTab extends PluginSettingTab {
  private readonly access: SettingAccess;
  private disposeEngineSection: (() => void) | null = null;
  private disposeMissingSidecarBanner: (() => void) | null = null;
  private disposeModelSection: (() => void) | null = null;
  private disposeSidecarSection: (() => void) | null = null;
  private missingSidecarProgressEl: HTMLDivElement | null = null;

  constructor(
    app: App,
    plugin: Plugin,
    private readonly dependencies: SettingsTabDependencies,
  ) {
    super(app, plugin);
    this.access = {
      getSettings: () => this.dependencies.getSettings(),
      persistOne: async (key, value) => {
        await this.dependencies.saveSettings({
          ...this.dependencies.getSettings(),
          [key]: value,
        });
      },
    };
  }

  override display(): void {
    this.tearDown();

    const { containerEl } = this;
    const settings = this.dependencies.getSettings();

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Local Dictation' });

    const missingSidecarGroup = containerEl.createDiv({ cls: 'setting-group' });
    this.disposeMissingSidecarBanner = this.renderMissingSidecarBanner(missingSidecarGroup);

    // --- Model ---
    const modelSection = createSettingGroup(containerEl, 'Model');
    const manager = this.dependencies.modelInstallManager;
    this.disposeModelSection = renderModelSection(modelSection, manager, {
      onManageModels: () => {
        new ManageModelsModal(this.app, {
          manager,
          onChanged: () => {
            this.display();
          },
        }).open();
      },
      onExternalFile: () => {
        const selectedModel = this.dependencies.getSettings().selectedModel;
        new ExternalModelFileModal(
          this.app,
          selectedModel?.kind === 'external_file' ? selectedModel.filePath : '',
          {
            manager,
            onChanged: async () => {
              this.display();
            },
          },
        ).open();
      },
      onModelInfo: this.buildModelInfoCallback(manager, settings),
    });

    // --- Transcription ---
    const transcriptionCard = createSettingGroup(containerEl, 'Transcription');

    addEnumSetting(transcriptionCard, this.access, {
      name: 'Listening mode',
      desc: 'Continuous or single-phrase capture.',
      key: 'listeningMode',
      options: LISTENING_MODE_OPTIONS,
      isValid: isListeningMode,
    });

    addEnumSetting(transcriptionCard, this.access, {
      name: 'Speaking style',
      desc: 'Pause detection speed.',
      tooltip:
        "How quickly the engine decides you've stopped speaking. Responsive — ends quickly. Balanced — standard detection (default). Patient — waits longer through pauses.",
      key: 'speakingStyle',
      options: SPEAKING_STYLE_OPTIONS,
      isValid: isSpeakingStyle,
    });

    addEnumSetting(transcriptionCard, this.access, {
      name: 'Insert text',
      desc: 'Where dictated text appears.',
      key: 'dictationAnchor',
      options: DICTATION_ANCHOR_OPTIONS,
      isValid: isDictationAnchor,
    });

    addEnumSetting(transcriptionCard, this.access, {
      name: 'Transcript formatting',
      desc: 'How speech is joined.',
      tooltip:
        'How dictated speech is joined within one session. Smart paragraphs use longer pauses as paragraph breaks.',
      key: 'transcriptFormatting',
      options: TRANSCRIPT_FORMATTING_OPTIONS,
      isValid: isTranscriptFormattingMode,
    });

    this.renderTimestampSettings(transcriptionCard, settings);

    // --- Engine options ---
    // Built inline (rather than via createSettingGroup) so renderEngineOptions
    // can hide the whole card when no rows apply (e.g. macOS + a model with
    // no initial-prompt support).
    const engineGroup = containerEl.createDiv({ cls: 'setting-group' });
    const engineHeading = new Setting(engineGroup).setName('Engine options').setHeading();
    const engineSection = engineGroup.createDiv({ cls: 'setting-items' });
    const renderEngine = (): void => {
      this.renderEngineOptions(engineGroup, engineHeading, engineSection);
    };
    renderEngine();
    this.disposeEngineSection = manager.subscribe(renderEngine);

    // --- Advanced (includes sidecar install/uninstall) ---
    const advancedSection = createSettingGroup(containerEl, 'Advanced');

    // Sidecar rows live in their own owned container so re-renders can simply
    // empty + rebuild without disturbing the rest of the Advanced section.
    const sidecarContainer = advancedSection.createDiv();
    const sidecarSection = new SidecarSettingsSection(sidecarContainer, {
      ...this.buildSidecarInstallActionDeps(),
      access: this.access,
      resolvePluginDirectory: this.dependencies.resolvePluginDirectory,
    });
    this.disposeSidecarSection = sidecarSection.init();

    addTextSetting(advancedSection, this.access, {
      name: 'Model store folder override',
      desc: 'Custom managed-model folder.',
      tooltip:
        'Optional absolute folder path for managed downloads. Leave blank to use the shared default model store.',
      key: 'modelStorePathOverride',
      placeholder: 'Use the shared default model store',
    });

    const disableLlmSetting = new Setting(advancedSection)
      .setName('Disable LLM features')
      .setDesc('Turn off the Ollama LLM transform and remove the LLM transformation sidebar.');
    disableLlmSetting.addToggle((toggle) => {
      toggle.setValue(!this.dependencies.getSettings().llmFeaturesEnabled);
      toggle.onChange(async (value) => {
        await this.access.persistOne('llmFeaturesEnabled', !value);
        this.display();
      });
    });

    const developerModeSetting = new Setting(advancedSection)
      .setName('Developer mode')
      .setDesc('Verbose console diagnostics.');
    developerModeSetting.addToggle((toggle) => {
      toggle.setValue(this.dependencies.getSettings().developerMode);
      toggle.onChange(async (value) => {
        await this.access.persistOne('developerMode', value);
        this.display();
      });
    });
  }

  override hide(): void {
    this.tearDown();
  }

  private tearDown(): void {
    this.disposeModelSection?.();
    this.disposeModelSection = null;
    this.disposeEngineSection?.();
    this.disposeEngineSection = null;
    this.disposeSidecarSection?.();
    this.disposeSidecarSection = null;
    this.disposeMissingSidecarBanner?.();
    this.disposeMissingSidecarBanner = null;
    this.missingSidecarProgressEl = null;
  }

  private renderTimestampSettings(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName('Timestamps')
      .setDesc('Session start header and inline landmarks at phrase boundaries.')
      .addToggle((toggle) => {
        toggle.setValue(settings.timestampsEnabled);
        toggle.onChange(async (value) => {
          await this.access.persistOne('timestampsEnabled', value);
          this.display();
        });
      });

    if (!settings.timestampsEnabled) return;

    const subRow = (setting: Setting): Setting => {
      setting.settingEl.addClass('local-stt-setting-subrow');
      return setting;
    };

    subRow(
      new Setting(parent)
        .setName('Session header')
        .setDesc('Emit [YYYY-MM-DD HH:MM] before the first phrase.')
        .addToggle((toggle) => {
          toggle.setValue(settings.timestampSessionHeader);
          toggle.onChange((value) => this.access.persistOne('timestampSessionHeader', value));
        }),
    );

    subRow(
      new Setting(parent)
        .setName('Reference clock')
        .setDesc('Elapsed since session start, or wall-clock time.')
        .addDropdown((dropdown) => {
          for (const option of TIMESTAMP_CLOCK_OPTIONS) {
            dropdown.addOption(option.value, option.label);
          }
          dropdown.setValue(settings.timestampClock);
          dropdown.onChange((value) => {
            if (isTimestampClock(value)) void this.access.persistOne('timestampClock', value);
          });
        }),
    );

    subRow(
      new Setting(parent)
        .setName('Density')
        .setDesc('Sparse: landmarks at long pauses or fixed intervals. Every phrase: one per phrase.')
        .addDropdown((dropdown) => {
          for (const option of TIMESTAMP_DENSITY_OPTIONS) {
            dropdown.addOption(option.value, option.label);
          }
          dropdown.setValue(settings.timestampDensity);
          dropdown.onChange((value) => {
            if (isTimestampDensity(value)) void this.access.persistOne('timestampDensity', value);
          });
        }),
    );

    const minSeconds = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
    const maxSeconds = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
    subRow(
      new Setting(parent)
        .setName('Sparse interval')
        .setDesc(`Seconds between sparse landmarks (${minSeconds}-${maxSeconds}).`)
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = String(minSeconds);
          text.inputEl.max = String(maxSeconds);
          text.inputEl.step = '1';
          text.setValue(String(Math.round(settings.timestampSparseIntervalMs / 1000)));
          text.onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) return;
            const clamped = Math.min(maxSeconds, Math.max(minSeconds, parsed));
            await this.access.persistOne('timestampSparseIntervalMs', clamped * 1000);
          });
        }),
    );
  }

  private buildModelInfoCallback(
    manager: ModelInstallManager,
    settings: PluginSettings,
  ): (() => void) | null {
    const sel = settings.selectedModel;

    if (sel === null || sel.kind !== 'catalog_model') {
      return null;
    }

    const { runtimeId, familyId, modelId } = sel;

    return () => {
      const state = manager.getState();
      const catalogModel = state.catalog.models.find((m) =>
        matchesModelTriple(m, runtimeId, familyId, modelId),
      );
      if (catalogModel === undefined) return;
      const installedModel = state.installedModels.find((m) =>
        matchesModelTriple(m, runtimeId, familyId, modelId),
      );
      const capabilities = resolveEngineCapabilities(
        state.compiledRuntimes,
        state.compiledAdapters,
        catalogModel.runtimeId,
        catalogModel.familyId,
      );
      new ModelDetailsModal(
        this.app,
        catalogModel,
        installedModel?.installPath ?? null,
        capabilities,
      ).open();
    };
  }

  private renderEngineOptions(
    group: HTMLDivElement,
    heading: Setting,
    containerEl: HTMLDivElement,
  ): void {
    const settings = this.dependencies.getSettings();
    const state = this.dependencies.modelInstallManager.getState();
    const sel = settings.selectedModel;
    const selectedAdapter =
      sel === null
        ? null
        : (state.compiledAdapters.find(
            (a) => a.runtimeId === sel.runtimeId && a.familyId === sel.familyId,
          ) ?? null);
    const selectedRuntime =
      sel === null
        ? null
        : (state.compiledRuntimes.find((r) => r.runtimeId === sel.runtimeId) ?? null);

    containerEl.empty();
    heading.setName(
      selectedAdapter === null ? 'Engine options' : `${selectedAdapter.displayName} engine`,
    );

    let rendered = 0;

    const hasNonCpuAccelerator =
      selectedRuntime?.runtimeCapabilities.availableAccelerators.some((id) => id !== 'cpu') ??
      false;

    if (!Platform.isMacOS && hasNonCpuAccelerator) {
      // accelerationPreference is a string enum mapped onto a boolean toggle, so
      // the addEnumSetting / addToggleSetting helpers don't fit.
      const accelSetting = new Setting(containerEl)
        .setName('Hardware acceleration')
        .setDesc('GPU when available.');
      accelSetting.addToggle((toggle) => {
        toggle.setValue(settings.accelerationPreference === 'auto');
        toggle.onChange(async (value) => {
          await this.access.persistOne('accelerationPreference', value ? 'auto' : 'cpu_only');
        });
      });
      appendInfoTooltip(
        accelSetting,
        'Run inference on the GPU when supported. Disable to force CPU on every engine.',
      );
      rendered += 1;
    }

    const caps = state.selectedModelCapabilities;
    if (caps.status === 'ready' && caps.capabilities.family.supportsInitialPrompt) {
      addToggleSetting(containerEl, this.access, {
        name: 'Use note as context',
        desc: 'Glossary prompt for supported engines.',
        tooltip:
          'Send a glossary of distinctive terms from the note as the engine’s prompt. Helps spell proper nouns and technical terms. Only used by engines that support initial prompts.',
        key: 'useNoteAsContext',
      });
      rendered += 1;
    }

    group.style.display = rendered === 0 ? 'none' : '';
  }

  private renderMissingSidecarBanner(group: HTMLDivElement): () => void {
    let disposed = false;

    const render = async (): Promise<void> => {
      this.missingSidecarProgressEl = null;
      group.empty();

      const pluginDirectory = await this.resolvePluginDirectorySafe();
      if (disposed || pluginDirectory === null || !group.isConnected) return;

      const [cpuManifest, cudaManifest] = await Promise.all([
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
      ]);
      if (disposed || !group.isConnected) return;

      const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;
      if (cpuManifest !== null || cudaManifest !== null) {
        group.style.display = 'none';
        return;
      }

      group.style.display = '';
      const items = group.createDiv({ cls: 'setting-items' });

      if (activeInstall !== null) {
        const { progressEl } = renderActiveInstallCard(items, {
          isCancelling: activeInstall.phase === 'canceling',
          name: `Installing: ${activeInstall.variant.toUpperCase()} sidecar`,
          onCancel: () => {
            this.dependencies.sidecarInstallManager.cancel();
          },
          progressState: buildSidecarProgressState(activeInstall),
        });
        this.missingSidecarProgressEl = progressEl;
        return;
      }

      const setting = new Setting(items)
        .setName('Sidecar required')
        .setDesc(
          'Local Dictation needs the speech-to-text sidecar to work. Install it to enable dictation.',
        );
      setting.addButton((button) => {
        button
          .setCta()
          .setButtonText('Install sidecar')
          .onClick(() => {
            openSidecarInstallModal(this.buildSidecarInstallActionDeps(), {
              intent: 'install',
              pluginDirectory,
              variant: 'cpu',
            });
          });
      });
    };

    const handleChange = (): void => {
      const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;

      if (activeInstall !== null && this.missingSidecarProgressEl !== null) {
        updateInstallProgressElement(
          this.missingSidecarProgressEl,
          buildSidecarProgressState(activeInstall),
        );
        return;
      }

      void render();
    };

    void render();
    const unsubscribe = this.dependencies.sidecarInstallManager.subscribe(handleChange);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }

  private resolvePluginDirectorySafe(): Promise<string | null> {
    return resolvePluginDirectorySafe(
      this.dependencies.resolvePluginDirectory,
      this.dependencies.logger,
    );
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
      isDictationBusy: this.dependencies.isDictationBusy,
      logger: this.dependencies.logger,
      modelInstallManager: this.dependencies.modelInstallManager,
      pluginVersion: this.dependencies.pluginVersion,
      refreshSettingsTab: () => {
        this.display();
      },
      restartSidecar: this.dependencies.restartSidecar,
      sidecarConnection: this.dependencies.sidecarConnection,
      sidecarInstallManager: this.dependencies.sidecarInstallManager,
    };
  }
}
