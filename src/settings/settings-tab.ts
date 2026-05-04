import type { App, Plugin } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { resolveEngineCapabilities } from '../models/capability-view';
import { ManageModelsModal } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import { ExternalModelFileModal, ModelDetailsModal } from '../models/model-management-modals';
import { matchesModelTriple } from '../models/model-management-types';
import { getInstallCopy, type InstallIntent } from '../setup/sidecar-install-copy';
import { SidecarInstallModal } from '../setup/sidecar-install-modal';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { detectNvidiaDriver, type NvidiaDriverStatus } from '../sidecar/gpu-precheck';
import type { SpeakingStyle } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import {
  type InstallManifest,
  readInstallManifest,
  type SidecarInstallVariant,
  uninstallSidecarVariant,
  variantDirectoryPath,
} from '../sidecar/sidecar-installer';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import { renderActiveInstallCard } from './install-progress-row';
import { renderModelSection } from './model-settings-section';
import {
  type DictationAnchor,
  isDictationAnchor,
  isListeningMode,
  isSpeakingStyle,
  isTranscriptFormattingMode,
  type PluginSettings,
  type TranscriptFormattingMode,
} from './plugin-settings';

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

// Filters PluginSettings keys whose value type is exactly T (not just assignable
// to T). Tuple-wrapping prevents distribution and the bidirectional check rejects
// narrower unions, so e.g. addTextSetting<SettingsKeyOf<string>> won't accept
// accelerationPreference ('auto' | 'cpu_only').
type SettingsKeyOf<T> = {
  [K in keyof PluginSettings]: [T] extends [PluginSettings[K]]
    ? [PluginSettings[K]] extends [T]
      ? K
      : never
    : never;
}[keyof PluginSettings];

interface SettingSpec {
  name: string;
  desc: string | DocumentFragment;
  tooltip?: string;
}

interface DropdownOption<V extends string> {
  label: string;
  value: V;
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

// Tags rows owned by renderSidecarSection so re-renders can find and remove
// only those rows from a section it shares with non-sidecar settings.
const SIDECAR_ROW_MARKER = 'data-stt-sidecar-row';

export class LocalSttSettingTab extends PluginSettingTab {
  private disposeEngineSection: (() => void) | null = null;
  private disposeMissingSidecarBanner: (() => void) | null = null;
  private disposeModelSection: (() => void) | null = null;
  private disposeSidecarSection: (() => void) | null = null;
  private missingSidecarProgressEl: HTMLDivElement | null = null;
  private nvidiaDriverStatus: Promise<NvidiaDriverStatus> | null = null;
  private sidecarProgressEl: HTMLDivElement | null = null;
  private sidecarRenderToken = 0;

  constructor(
    app: App,
    plugin: Plugin,
    private readonly dependencies: SettingsTabDependencies,
  ) {
    super(app, plugin);
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
    const modelSection = this.createSettingGroup(containerEl, 'Model');
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
    const transcriptionCard = this.createSettingGroup(containerEl, 'Transcription');

    this.addEnumSetting(transcriptionCard, {
      name: 'Listening mode',
      desc: 'Continuous or single-phrase capture.',
      key: 'listeningMode',
      options: LISTENING_MODE_OPTIONS,
      isValid: isListeningMode,
    });

    this.addEnumSetting(transcriptionCard, {
      name: 'Speaking style',
      desc: 'Pause detection speed.',
      tooltip:
        "How quickly the engine decides you've stopped speaking. Responsive — ends quickly. Balanced — standard detection (default). Patient — waits longer through pauses.",
      key: 'speakingStyle',
      options: SPEAKING_STYLE_OPTIONS,
      isValid: isSpeakingStyle,
    });

    this.addEnumSetting(transcriptionCard, {
      name: 'Insert text',
      desc: 'Where dictated text appears.',
      key: 'dictationAnchor',
      options: DICTATION_ANCHOR_OPTIONS,
      isValid: isDictationAnchor,
    });

    this.addEnumSetting(transcriptionCard, {
      name: 'Transcript formatting',
      desc: 'How speech is joined.',
      tooltip:
        'How dictated speech is joined within one session. Smart paragraphs use longer pauses as paragraph breaks.',
      key: 'transcriptFormatting',
      options: TRANSCRIPT_FORMATTING_OPTIONS,
      isValid: isTranscriptFormattingMode,
    });

    this.addToggleSetting(transcriptionCard, {
      name: 'Show timestamps',
      desc: 'Sparse elapsed-session timestamps.',
      tooltip:
        'Add sparse elapsed-session timestamps at speech-segment boundaries from the voice-activity detector (VAD).',
      key: 'showTimestamps',
    });

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
    const advancedSection = this.createSettingGroup(containerEl, 'Advanced');

    // Sidecar rows live alongside Model store / Developer mode in this section.
    // renderSidecarSection tags its rows with SIDECAR_ROW_MARKER so re-renders
    // only touch those rows.
    void this.renderSidecarSection(advancedSection);
    this.disposeSidecarSection = this.dependencies.sidecarInstallManager.subscribe(() => {
      this.handleSidecarSectionChange(advancedSection);
    });

    this.addTextSetting(advancedSection, {
      name: 'Model store folder override',
      desc: 'Custom managed-model folder.',
      tooltip:
        'Optional absolute folder path for managed downloads. Leave blank to use the shared default model store.',
      key: 'modelStorePathOverride',
      placeholder: 'Use the shared default model store',
    });

    const developerModeSetting = new Setting(advancedSection)
      .setName('Developer mode')
      .setDesc('Verbose console diagnostics.');
    developerModeSetting.addToggle((toggle) => {
      toggle.setValue(this.dependencies.getSettings().developerMode);
      toggle.onChange(async (value) => {
        await this.persistOne('developerMode', value);
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
    this.sidecarProgressEl = null;
    this.missingSidecarProgressEl = null;
    this.nvidiaDriverStatus = null;
    this.sidecarRenderToken = 0;
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
          await this.persistOne('accelerationPreference', value ? 'auto' : 'cpu_only');
        });
      });
      this.appendInfoTooltip(
        accelSetting,
        'Run inference on the GPU when supported. Disable to force CPU on every engine.',
      );
      rendered += 1;
    }

    const caps = state.selectedModelCapabilities;
    if (caps.status === 'ready' && caps.capabilities.family.supportsInitialPrompt) {
      this.addToggleSetting(containerEl, {
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

  private async renderSidecarSection(section: HTMLDivElement): Promise<void> {
    // Generation token: when the install manager fires multiple notify()s,
    // handleSidecarSectionChange schedules concurrent renders on the same live
    // section element. Without coalescing, both pass the remove step and both
    // append rows, producing duplicates. Each render captures a token, and any
    // call whose token is no longer current bails before mutating the DOM.
    const token = ++this.sidecarRenderToken;
    const isStale = (): boolean => token !== this.sidecarRenderToken || !section.isConnected;

    const pluginDirectory = await this.resolvePluginDirectorySafe();
    if (pluginDirectory === null || isStale()) return;

    let cpuManifest: InstallManifest | null;
    let cudaManifest: InstallManifest | null = null;
    let driverStatus: NvidiaDriverStatus = 'absent';

    if (Platform.isMacOS) {
      cpuManifest = await readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu'));
      if (isStale()) return;
    } else {
      if (this.nvidiaDriverStatus === null) {
        this.nvidiaDriverStatus = detectNvidiaDriver();
      }
      [cpuManifest, cudaManifest, driverStatus] = await Promise.all([
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
        this.nvidiaDriverStatus,
      ]);
      if (isStale()) return;
    }

    // Anchor for re-render insertion: the first child not tagged as ours
    // (Model store / Developer mode on first paint, same on subsequent paints
    // because we always insert before this anchor).
    const insertBefore =
      Array.from(section.children).find((c) => !c.hasAttribute(SIDECAR_ROW_MARKER)) ?? null;

    for (const child of Array.from(section.children)) {
      if (child.hasAttribute(SIDECAR_ROW_MARKER)) child.remove();
    }
    this.sidecarProgressEl = null;

    // Render into a detached scratch div, tag each new top-level child, then
    // move them in front of the anchor. Lets us reuse helpers that append to
    // their parent without splicing them by hand.
    const append = (renderFn: (target: HTMLDivElement) => void): void => {
      const scratch = document.createElement('div');
      renderFn(scratch as HTMLDivElement);
      while (scratch.firstChild !== null) {
        const child = scratch.firstChild as HTMLElement;
        child.setAttribute(SIDECAR_ROW_MARKER, '');
        section.insertBefore(child, insertBefore);
      }
    };

    const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;
    const renderActiveCard = (active: NonNullable<typeof activeInstall>): void => {
      append((target) => {
        const { progressEl } = renderActiveInstallCard(target, {
          isCancelling: active.phase === 'canceling',
          name: Platform.isMacOS
            ? 'Installing sidecar'
            : `Installing: ${active.variant.toUpperCase()} sidecar`,
          onCancel: () => {
            this.dependencies.sidecarInstallManager.cancel();
          },
          progressState: buildSidecarProgressState(active),
        });
        this.sidecarProgressEl = progressEl;
      });
    };

    if (Platform.isMacOS) {
      append((target) => {
        this.renderSidecarInstallRow(target, {
          desc: 'Speech-to-text engine.',
          manifest: cpuManifest,
          name: 'Sidecar',
          pluginDirectory,
          tooltipExtra: 'Includes Metal acceleration on Apple Silicon and Intel Macs.',
          variant: 'cpu',
        });
      });
      if (activeInstall !== null) renderActiveCard(activeInstall);
    } else {
      append((target) => {
        this.renderSidecarInstallRow(target, {
          desc: 'Speech-to-text engine. Required.',
          manifest: cpuManifest,
          name: 'CPU sidecar',
          pluginDirectory,
          variant: 'cpu',
        });
      });
      if (activeInstall !== null && activeInstall.variant === 'cpu') {
        renderActiveCard(activeInstall);
      }

      append((target) => {
        this.renderGpuSidecarRow(target, cudaManifest, pluginDirectory, driverStatus);
      });
      if (activeInstall !== null && activeInstall.variant === 'cuda') {
        renderActiveCard(activeInstall);
      }
    }

    if (Platform.isLinux) {
      append((target) => {
        this.addTextSetting(target, {
          name: 'CUDA library path',
          desc: 'Sidecar-only CUDA search path.',
          tooltip:
            'Optional colon-separated library search path for the sidecar process only. Use this for Flatpak or custom CUDA installs without changing Obsidian’s global environment.',
          key: 'cudaLibraryPath',
          placeholder: '/run/host/usr/local/cuda-12.9/targets/x86_64-linux/lib:/run/host/usr/lib64',
        });
      });
    }

    if (this.dependencies.getSettings().developerMode) {
      append((target) => {
        this.addTextSetting(target, {
          name: 'Sidecar path override',
          desc: 'Custom sidecar executable.',
          tooltip: 'Optional absolute path to an installed or dev sidecar executable file.',
          key: 'sidecarPathOverride',
          placeholder: 'Auto-detect from bin/cpu, bin/cuda, or native/target debug builds',
        });

        this.addPositiveIntSetting(target, {
          name: 'Startup timeout (s)',
          desc: 'Startup health-check limit.',
          tooltip: 'Maximum time allowed for the startup health handshake.',
          key: 'sidecarStartupTimeoutSeconds',
        });

        this.addPositiveIntSetting(target, {
          name: 'Request timeout (s)',
          desc: 'Sidecar request limit.',
          tooltip:
            'Maximum time allowed for start, stop, cancel, health, and model-management requests before failing them.',
          key: 'sidecarRequestTimeoutSeconds',
        });
      });
    }
  }

  private handleSidecarSectionChange(section: HTMLDivElement): void {
    const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;

    if (activeInstall !== null && this.sidecarProgressEl !== null) {
      updateInstallProgressElement(
        this.sidecarProgressEl,
        buildSidecarProgressState(activeInstall),
      );
      return;
    }

    void this.renderSidecarSection(section);
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
            this.openInstallModal(pluginDirectory, 'cpu', 'install');
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

  private renderSidecarInstallRow(
    container: HTMLDivElement,
    opts: {
      desc: string;
      manifest: InstallManifest | null;
      name: string;
      pluginDirectory: string;
      tooltipExtra?: string;
      variant: SidecarInstallVariant;
    },
  ): void {
    const setting = new Setting(container).setName(opts.name).setDesc(opts.desc);
    this.addInstallButtons(setting, opts.manifest !== null, {
      onInstall: () => {
        this.openInstallModal(opts.pluginDirectory, opts.variant, 'install');
      },
      onReinstall: () => {
        this.openInstallModal(opts.pluginDirectory, opts.variant, 'reinstall');
      },
      onUninstall: () => {
        void this.handleUninstallVariant(opts.pluginDirectory, opts.variant);
      },
    });
    this.appendInfoTooltip(setting, formatSidecarTooltip(opts.manifest, opts.tooltipExtra));
  }

  private renderGpuSidecarRow(
    container: HTMLDivElement,
    manifest: InstallManifest | null,
    pluginDirectory: string,
    driverStatus: NvidiaDriverStatus,
  ): void {
    const driverReason = describeDriverStatus(driverStatus);

    const isInstalled = manifest !== null;
    const setting = new Setting(container)
      .setName('GPU sidecar')
      .setDesc(isInstalled ? 'NVIDIA CUDA acceleration.' : driverReason.label);

    this.addInstallButtons(setting, isInstalled, {
      installCta: driverStatus === 'present',
      installDisabled: driverStatus === 'absent',
      onInstall: () => {
        this.openCudaInstallModal(pluginDirectory);
      },
      onReinstall: () => {
        this.openInstallModal(pluginDirectory, 'cuda', 'reinstall');
      },
      onUninstall: () => {
        void this.handleUninstallVariant(pluginDirectory, 'cuda');
      },
    });

    if (!isInstalled && driverStatus === 'absent') {
      setting.addButton((button) => {
        button.setButtonText('Install anyway');
        button.setTooltip('Proceed with CUDA install even though no NVIDIA driver was detected.');
        button.onClick(() => {
          this.openCudaInstallModal(pluginDirectory);
        });
      });
    }

    this.appendInfoTooltip(
      setting,
      isInstalled
        ? formatSidecarTooltip(manifest, 'NVIDIA CUDA backend.')
        : formatSidecarTooltip(null, driverReason.tooltip),
    );
  }

  private addInstallButtons(
    setting: Setting,
    isInstalled: boolean,
    opts: {
      installCta?: boolean;
      installDisabled?: boolean;
      onInstall: () => void;
      onReinstall: () => void;
      onUninstall: () => void;
    },
  ): void {
    if (isInstalled) {
      setting.addButton((button) => {
        button.setButtonText('Reinstall').onClick(opts.onReinstall);
      });
      setting.addButton((button) => {
        button.setButtonText('Uninstall').setWarning().onClick(opts.onUninstall);
      });
      return;
    }

    setting.addButton((button) => {
      button.setButtonText('Install').onClick(opts.onInstall);
      if (opts.installCta ?? true) button.setCta();
      if (opts.installDisabled === true) button.setDisabled(true);
    });
  }

  // Build the native Obsidian "setting-group" structure used by core settings
  // tabs: a wrapper div with a heading row, then a "setting-items" sibling
  // that holds the actual rows. Obsidian's bundled CSS targets this shape to
  // produce the rounded card with internal dividers.
  private createSettingGroup(parent: HTMLElement, heading: string): HTMLDivElement {
    const group = parent.createDiv({ cls: 'setting-group' });
    new Setting(group).setName(heading).setHeading();
    return group.createDiv({ cls: 'setting-items' });
  }

  private addEnumSetting<K extends keyof PluginSettings>(
    parent: HTMLElement,
    spec: SettingSpec & {
      key: K;
      options: ReadonlyArray<DropdownOption<PluginSettings[K] & string>>;
      isValid: (value: unknown) => value is PluginSettings[K];
    },
  ): void {
    const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
    setting.addDropdown((dropdown) => {
      for (const option of spec.options) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(this.dependencies.getSettings()[spec.key] as unknown as string);
      dropdown.onChange(async (value) => {
        if (!spec.isValid(value)) return;
        await this.persistOne(spec.key, value);
      });
    });
    this.appendInfoTooltip(setting, spec.tooltip);
  }

  private addToggleSetting<K extends SettingsKeyOf<boolean>>(
    parent: HTMLElement,
    spec: SettingSpec & { key: K },
  ): void {
    const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
    setting.addToggle((toggle) => {
      toggle.setValue(this.dependencies.getSettings()[spec.key] as boolean);
      toggle.onChange(async (value) => {
        await this.persistOne(spec.key, value as PluginSettings[K]);
      });
    });
    this.appendInfoTooltip(setting, spec.tooltip);
  }

  private addTextSetting<K extends SettingsKeyOf<string>>(
    parent: HTMLElement,
    spec: SettingSpec & { key: K; placeholder?: string },
  ): void {
    const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
    setting.addText((text) => {
      if (spec.placeholder !== undefined) text.setPlaceholder(spec.placeholder);
      text.setValue(this.dependencies.getSettings()[spec.key] as string);
      text.onChange(async (value) => {
        await this.persistOne(spec.key, value.trim() as PluginSettings[K]);
      });
    });
    this.appendInfoTooltip(setting, spec.tooltip);
  }

  private addPositiveIntSetting<K extends SettingsKeyOf<number>>(
    parent: HTMLElement,
    spec: SettingSpec & { key: K },
  ): void {
    const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
    setting.addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(String(this.dependencies.getSettings()[spec.key]));
      text.onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) return;
        await this.persistOne(spec.key, parsed as PluginSettings[K]);
      });
    });
    this.appendInfoTooltip(setting, spec.tooltip);
  }

  private appendInfoTooltip(setting: Setting, tooltip: string | undefined): void {
    if (tooltip === undefined) return;
    setting.addExtraButton((button) => {
      button.setIcon('info').setTooltip(tooltip);
    });
  }

  private openCudaInstallModal(pluginDirectory: string): void {
    this.openInstallModal(pluginDirectory, 'cuda', 'install', async () => {
      await this.persistOne('accelerationPreference', 'auto');
    });
  }

  private openInstallModal(
    pluginDirectory: string,
    variant: SidecarInstallVariant,
    intent: InstallIntent,
    onInstalled?: () => Promise<void>,
  ): void {
    if (this.dependencies.isDictationBusy()) {
      new Notice('Stop dictation before installing a sidecar — the install restarts the engine.');
      return;
    }

    new SidecarInstallModal(this.app, {
      beforeReplace: async () => {
        await this.shutdownSidecarBeforeFileMutation(`${variant} install`);
      },
      copy: getInstallCopy(variant, intent),
      manager: this.dependencies.sidecarInstallManager,
      onInstalled: async () => {
        await onInstalled?.();
        await this.dependencies.restartSidecar();
        await this.dependencies.modelInstallManager.init();
        this.display();
      },
      pluginDirectory,
      variant,
      version: this.dependencies.pluginVersion,
    }).open();
  }

  private async handleUninstallVariant(
    pluginDirectory: string,
    variant: SidecarInstallVariant,
  ): Promise<void> {
    const variantLabel = variant === 'cuda' ? 'CUDA' : 'CPU';
    const userFacingName = Platform.isMacOS ? 'sidecar' : `${variantLabel} sidecar`;

    if (this.dependencies.isDictationBusy()) {
      new Notice(`Stop dictation before uninstalling the ${userFacingName}.`);
      return;
    }

    await this.shutdownSidecarBeforeFileMutation(`${variantLabel} uninstall`);

    try {
      await uninstallSidecarVariant(pluginDirectory, variant);
    } catch (error) {
      this.dependencies.logger?.error(
        'installer',
        `failed to uninstall ${variantLabel} sidecar`,
        error,
      );
      new Notice(`Failed to uninstall ${userFacingName}: ${formatErrorMessage(error)}`);
      return;
    }

    new Notice(
      Platform.isMacOS
        ? 'Sidecar uninstalled.'
        : variant === 'cuda'
          ? 'CUDA sidecar uninstalled. Running on CPU.'
          : 'CPU sidecar uninstalled.',
    );
    this.display();

    try {
      await this.dependencies.restartSidecar();
    } catch (error) {
      if (error instanceof SidecarNotInstalledError) return;
      this.dependencies.logger?.warn('installer', 'sidecar restart after uninstall failed', error);
      new Notice(`Sidecar could not restart: ${formatErrorMessage(error)}`);
    }
  }

  private async shutdownSidecarBeforeFileMutation(reason: string): Promise<void> {
    // Windows holds DLL handles on the live sidecar process, so install and
    // uninstall paths must stop it before removing or replacing bin/*.
    try {
      await this.dependencies.sidecarConnection.shutdown();
    } catch (error) {
      this.dependencies.logger?.warn(
        'installer',
        `sidecar shutdown failed before ${reason}; proceeding`,
        error,
      );
    }
  }

  private async resolvePluginDirectorySafe(): Promise<string | null> {
    try {
      return await this.dependencies.resolvePluginDirectory();
    } catch (error) {
      this.dependencies.logger?.error('installer', 'failed to resolve plugin directory', error);
      return null;
    }
  }

  private async persistOne<K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K],
  ): Promise<void> {
    await this.dependencies.saveSettings({
      ...this.dependencies.getSettings(),
      [key]: value,
    });
  }
}

function formatSidecarTooltip(manifest: InstallManifest | null, extra?: string): string {
  const base = manifest === null ? 'Not installed.' : `Installed: ${manifest.version}.`;
  return extra === undefined ? base : `${base} ${extra}`;
}

function describeDriverStatus(status: NvidiaDriverStatus): { label: string; tooltip: string } {
  switch (status) {
    case 'present':
      return {
        label: 'NVIDIA driver detected.',
        tooltip: 'Downloads the CUDA sidecar archive from GitHub releases.',
      };
    case 'absent':
      return {
        label: 'No NVIDIA driver detected.',
        tooltip:
          'nvidia-smi was not found on PATH. Use "Install anyway" if you are certain your system supports CUDA.',
      };
    case 'unknown':
      return {
        label: 'NVIDIA driver status unknown.',
        tooltip:
          'Unable to probe for an NVIDIA driver. Proceed only if you know your GPU supports CUDA.',
      };
  }
}
