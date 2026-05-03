import type { App, Plugin } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { resolveEngineCapabilities } from '../models/capability-view';
import { ManageModelsModal } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import { ExternalModelFileModal, ModelDetailsModal } from '../models/model-management-modals';
import { matchesModelTriple } from '../models/model-management-types';
import { getInstallCopy, type InstallIntent } from '../setup/sidecar-install-copy';
import { SidecarInstallModal } from '../setup/sidecar-install-modal';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { detectNvidiaDriver, type NvidiaDriverStatus } from '../sidecar/gpu-precheck';
import { LISTENING_MODES, type ListeningMode, type SystemInfoEvent } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  type InstallManifest,
  readInstallManifest,
  type SidecarInstallVariant,
  uninstallSidecarVariant,
  variantDirectoryPath,
} from '../sidecar/sidecar-installer';
import { describeAcceleration } from './acceleration-info';
import { renderModelSection } from './model-settings-section';
import {
  type DICTATION_ANCHORS,
  isDictationAnchor,
  isSpeakingStyle,
  isTranscriptFormattingMode,
  type PluginSettings,
  type SPEAKING_STYLES,
  type TRANSCRIPT_FORMATTING_MODES,
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
  sidecarConnection: Pick<SidecarConnection, 'getSystemInfo' | 'shutdown'>;
}

// Keys whose value type is exactly T (not a string-literal union assignable to T).
// Both directions guard against e.g. accelerationPreference ('auto' | 'cpu_only')
// leaking into addTextSetting<SettingsKeyOf<string>>. Tuple-wrapped to suppress
// distribution over boolean = true | false.
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

const LISTENING_MODE_OPTIONS: ReadonlyArray<DropdownOption<ListeningMode>> = [
  { label: 'Always on', value: 'always_on' },
  { label: 'One sentence', value: 'one_sentence' },
];

const DICTATION_ANCHOR_OPTIONS: ReadonlyArray<DropdownOption<(typeof DICTATION_ANCHORS)[number]>> =
  [
    { label: 'At cursor', value: 'at_cursor' },
    { label: 'End of note', value: 'end_of_note' },
  ];

const TRANSCRIPT_FORMATTING_OPTIONS: ReadonlyArray<
  DropdownOption<(typeof TRANSCRIPT_FORMATTING_MODES)[number]>
> = [
  { label: 'Smart paragraphs', value: 'smart' },
  { label: 'Space', value: 'space' },
  { label: 'New line', value: 'new_line' },
  { label: 'New paragraph', value: 'new_paragraph' },
];

const SPEAKING_STYLE_OPTIONS: ReadonlyArray<DropdownOption<(typeof SPEAKING_STYLES)[number]>> = [
  { label: 'Responsive', value: 'responsive' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Patient', value: 'patient' },
];

function isListeningMode(value: unknown): value is ListeningMode {
  return typeof value === 'string' && (LISTENING_MODES as readonly string[]).includes(value);
}

export class LocalSttSettingTab extends PluginSettingTab {
  private disposeEngineSection: (() => void) | null = null;
  private disposeModelSection: (() => void) | null = null;
  private nvidiaDriverStatus: Promise<NvidiaDriverStatus> | null = null;

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
    containerEl.createEl('h2', { text: 'Local Transcript' });

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
      tooltip:
        'Choose whether dictation keeps listening continuously or captures one phrase and stops.',
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
      name: 'Dictation anchor',
      desc: 'Session insertion point.',
      tooltip:
        'Where each dictation session anchors. The first phrase lands here and stays pinned for the rest of the session, even if you click elsewhere in the note.',
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
      tooltip: 'Add sparse elapsed-session timestamps before selected speech segments.',
      key: 'showTimestamps',
    });

    // --- Engine options ---
    // Inline construction (rather than createSettingGroup) gives bindEngineOptions
    // access to the wrapper group so it can hide the whole card when no rows apply
    // (e.g. macOS with a model that doesn't support initial prompts).
    const engineGroup = containerEl.createDiv({ cls: 'setting-group' });
    new Setting(engineGroup).setName('Engine options').setHeading();
    const engineSection = engineGroup.createDiv({ cls: 'setting-items' });
    void this.bindEngineOptions(engineGroup, engineSection, manager);

    // --- Sidecar ---
    const sidecarSection = this.createSettingGroup(containerEl, 'Sidecar');
    void (async () => {
      await this.renderSidecarRows(sidecarSection);

      this.addTextSetting(sidecarSection, {
        name: 'Sidecar path override',
        desc: 'Custom sidecar executable.',
        tooltip: 'Optional absolute path to an installed or dev sidecar executable file.',
        key: 'sidecarPathOverride',
        placeholder: 'Auto-detect from bin/cpu, bin/cuda, or native/target debug builds',
      });

      if (Platform.isLinux) {
        this.addTextSetting(sidecarSection, {
          name: 'CUDA library path',
          desc: 'Sidecar-only CUDA search path.',
          tooltip:
            'Optional colon-separated library search path for the sidecar process only. Use this for Flatpak or custom CUDA installs without changing Obsidian’s global environment.',
          key: 'cudaLibraryPath',
          placeholder: '/run/host/usr/local/cuda-12.9/targets/x86_64-linux/lib:/run/host/usr/lib64',
        });
      }

      this.addPositiveIntSetting(sidecarSection, {
        name: 'Startup timeout (s)',
        desc: 'Startup health-check limit.',
        tooltip: 'Maximum time allowed for the startup health handshake.',
        key: 'sidecarStartupTimeoutSeconds',
      });

      this.addPositiveIntSetting(sidecarSection, {
        name: 'Request timeout (s)',
        desc: 'Sidecar request limit.',
        tooltip:
          'Maximum time allowed for start, stop, cancel, health, and model-management requests before failing them.',
        key: 'sidecarRequestTimeoutSeconds',
      });
    })();

    // --- Advanced ---
    const advancedSection = this.createSettingGroup(containerEl, 'Advanced');

    this.addTextSetting(advancedSection, {
      name: 'Model store folder override',
      desc: 'Custom managed-model folder.',
      tooltip:
        'Optional absolute folder path for managed downloads. Leave blank to use the shared default model store.',
      key: 'modelStorePathOverride',
      placeholder: 'Use the shared default model store',
    });

    this.addToggleSetting(advancedSection, {
      name: 'Developer mode',
      desc: 'Verbose console diagnostics.',
      tooltip:
        'Log verbose diagnostic output to the developer console (Ctrl+Shift+I). Useful for debugging or reporting issues.',
      key: 'developerMode',
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
    this.nvidiaDriverStatus = null;
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

  private async bindEngineOptions(
    group: HTMLDivElement,
    containerEl: HTMLDivElement,
    manager: ModelInstallManager,
  ): Promise<void> {
    const systemInfo = await this.fetchSystemInfo();
    this.renderEngineOptions(group, containerEl, systemInfo);
    this.disposeEngineSection = manager.subscribe(() => {
      this.renderEngineOptions(group, containerEl, systemInfo);
    });
  }

  private renderEngineOptions(
    group: HTMLDivElement,
    containerEl: HTMLDivElement,
    systemInfo: SystemInfoEvent | null,
  ): void {
    const settings = this.dependencies.getSettings();

    containerEl.empty();

    let rendered = 0;

    if (!Platform.isMacOS) {
      const { label } = describeAcceleration(systemInfo, settings.accelerationPreference);
      const descFragment = document.createDocumentFragment();
      descFragment.createSpan({ text: 'Use the GPU when available.' });
      descFragment.createEl('br');
      descFragment.createSpan({ text: `Currently: ${label}` });

      // accelerationPreference is a string enum, not a boolean, so the simple
      // toggle builder doesn't fit — toggle here drives an enum mapping.
      const accelSetting = new Setting(containerEl)
        .setName('Hardware acceleration')
        .setDesc(descFragment);
      accelSetting.addToggle((toggle) => {
        toggle.setValue(settings.accelerationPreference === 'auto');
        toggle.onChange(async (value) => {
          await this.persistOne('accelerationPreference', value ? 'auto' : 'cpu_only');
          this.renderEngineOptions(group, containerEl, systemInfo);
        });
      });
      this.appendInfoTooltip(accelSetting, 'Turn off to run every engine on CPU.');
      rendered += 1;
    }

    const caps = this.dependencies.modelInstallManager.getState().selectedModelCapabilities;
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

  private async renderSidecarRows(container: HTMLDivElement): Promise<void> {
    const pluginDirectory = await this.resolvePluginDirectorySafe();
    if (pluginDirectory === null) return;

    const [cpuManifest, cudaManifest] = await Promise.all([
      readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
      readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
    ]);

    if (Platform.isMacOS) {
      this.renderInstallableRow(container, {
        desc: 'Speech-to-text engine.',
        manifest: cpuManifest,
        name: 'Sidecar',
        pluginDirectory,
        tooltipExtra: 'Includes Metal acceleration on Apple Silicon and Intel Macs.',
        variant: 'cpu',
      });
      return;
    }

    this.renderInstallableRow(container, {
      desc: 'Speech-to-text engine. Required.',
      manifest: cpuManifest,
      name: 'CPU sidecar',
      pluginDirectory,
      variant: 'cpu',
    });

    await this.renderGpuSidecarRow(container, cudaManifest, pluginDirectory);
  }

  private renderInstallableRow(
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
    const isInstalled = opts.manifest !== null;
    const setting = new Setting(container).setName(opts.name).setDesc(opts.desc);

    if (isInstalled) {
      setting.addButton((button) => {
        button.setButtonText('Reinstall');
        button.onClick(() => {
          this.openInstallModal(opts.pluginDirectory, opts.variant, 'reinstall');
        });
      });
      setting.addButton((button) => {
        button.setButtonText('Uninstall').setWarning();
        button.onClick(() => {
          void this.handleUninstallVariant(opts.pluginDirectory, opts.variant);
        });
      });
    } else {
      setting.addButton((button) => {
        button.setButtonText('Install').setCta();
        button.onClick(() => {
          this.openInstallModal(opts.pluginDirectory, opts.variant, 'install');
        });
      });
    }

    this.appendInfoTooltip(setting, formatSidecarTooltip(opts.manifest, opts.tooltipExtra));
  }

  private async renderGpuSidecarRow(
    container: HTMLDivElement,
    manifest: InstallManifest | null,
    pluginDirectory: string,
  ): Promise<void> {
    const isInstalled = manifest !== null;

    // Memoize the nvidia-smi probe for the tab's lifetime. display() can fire
    // multiple times per tab open; spawning a child process on each render is
    // wasteful. Cleared in tearDown() so the driver state is re-probed next
    // time the tab opens.
    if (this.nvidiaDriverStatus === null) {
      this.nvidiaDriverStatus = detectNvidiaDriver();
    }
    const driverStatus = await this.nvidiaDriverStatus;
    const driverReason = describeDriverStatus(driverStatus);

    const setting = new Setting(container)
      .setName('GPU sidecar')
      .setDesc(isInstalled ? 'NVIDIA CUDA acceleration.' : driverReason.label);

    if (isInstalled) {
      setting.addButton((button) => {
        button.setButtonText('Reinstall');
        button.onClick(() => {
          this.openInstallModal(pluginDirectory, 'cuda', 'reinstall');
        });
      });
      setting.addButton((button) => {
        button.setButtonText('Uninstall').setWarning();
        button.onClick(() => {
          void this.handleUninstallVariant(pluginDirectory, 'cuda');
        });
      });
    } else {
      setting.addButton((button) => {
        button.setButtonText('Install');
        if (driverStatus === 'absent') button.setDisabled(true);
        else if (driverStatus === 'present') button.setCta();
        button.onClick(() => {
          this.openCudaInstallModal(pluginDirectory);
        });
      });
      if (driverStatus === 'absent') {
        setting.addButton((button) => {
          button.setButtonText('Install anyway');
          button.setTooltip('Proceed with CUDA install even though no NVIDIA driver was detected.');
          button.onClick(() => {
            this.openCudaInstallModal(pluginDirectory);
          });
        });
      }
    }

    const tooltip = isInstalled
      ? formatSidecarTooltip(manifest, 'NVIDIA CUDA backend.')
      : formatSidecarTooltip(null, driverReason.tooltip);
    this.appendInfoTooltip(setting, tooltip);
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
      logger: this.dependencies.logger,
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
    if (this.dependencies.isDictationBusy()) {
      new Notice(`Stop dictation before uninstalling the ${variantLabel} sidecar.`);
      return;
    }

    await this.shutdownSidecarBeforeFileMutation(`${variantLabel} uninstall`);

    try {
      await uninstallSidecarVariant(pluginDirectory, variant);
      await this.dependencies.restartSidecar();
      new Notice(
        variant === 'cuda'
          ? 'CUDA sidecar uninstalled. Running on CPU.'
          : 'CPU sidecar uninstalled.',
      );
      this.display();
    } catch (error) {
      this.dependencies.logger?.error(
        'installer',
        `failed to uninstall ${variantLabel} sidecar`,
        error,
      );
      new Notice(`Failed to uninstall ${variantLabel} sidecar: ${formatErrorMessage(error)}`);
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

  private async fetchSystemInfo(): Promise<SystemInfoEvent | null> {
    try {
      return await this.dependencies.sidecarConnection.getSystemInfo();
    } catch {
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
