import { randomUUID } from 'node:crypto';

import { ItemView, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import type { OllamaClient, OllamaModelOption } from '../llm/ollama-client';
import {
  DEFAULT_LLM_BUILTIN_PRESET_ID,
  findMatchingStyleRef,
  formatStyleRef,
  getLlmBuiltinPreset,
  isLlmPresetMode,
  LLM_BUILTIN_PRESETS,
  type LlmPresetMode,
  type LlmStyleOption,
  type LlmUserPreset,
  listStyleOptions,
  parseStyleRef,
  resolveStyleOption,
} from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_COUNT,
  type PluginSettings,
  resetLlmPostprocessDefaults,
} from '../settings/plugin-settings';
import {
  addNumberInputSetting,
  addTextAreaSetting,
  appendInfoTooltip,
  createSettingGroup,
} from '../settings/setting-helpers';
import type { PluginLogger } from '../shared/plugin-logger';
import { ConfirmModal } from './confirm-modal';
import { SaveStyleModal } from './save-style-modal';

export const LOCAL_DICTATION_VIEW_TYPE = 'local-dictation-sidebar';
const LOCAL_DICTATION_VIEW_TITLE = 'Local Dictation';
const LOCAL_DICTATION_VIEW_ICON = 'audio-lines';
const HEADING_TOOLTIP =
  'Uses a local Ollama model to transform the dictated transcript — cleaning, rewriting, summarizing, reformatting, or running custom prompts. Transcription stays local.';
const STYLE_PICKER_TOOLTIP =
  'A preset is a saved LLM transform prompt. Pick a built-in preset or a saved preset. Editing the prompt switches to Custom. The suffix after each preset name shows which mode it is meant for: (per phrase) runs after every spoken phrase, (batch) runs once when you stop, (either) works in both — picking a (per phrase) or (batch) preset will switch the mode for you.';
const CUSTOM_STYLE_VALUE = '__custom__';

const DEFAULT_ENABLED_CLEANUP_MODE: LlmPresetMode = 'per_utterance';

const CLEANUP_MODE_OPTIONS: ReadonlyArray<{ label: string; value: LlmPresetMode }> = [
  { label: 'After each phrase', value: 'per_utterance' },
  { label: 'All at once on stop', value: 'batch' },
];

interface LocalDictationViewDependencies {
  getSettings: () => PluginSettings;
  logger?: PluginLogger | undefined;
  notice?: (message: string) => void;
  ollamaClient: OllamaClient;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

const PROMPT_SAVE_DEBOUNCE_MS = 400;

export class LocalDictationView extends ItemView {
  private advancedOpen = false;
  private focusedInput: HTMLElement | null = null;
  private models: OllamaModelOption[] = [];
  private ollamaStatus = 'Ollama status unknown.';
  private lastEnabledMode: LlmPresetMode = DEFAULT_ENABLED_CLEANUP_MODE;
  private promptBlurRenderPending = false;
  private promptSaveTimerId: ReturnType<typeof setTimeout> | null = null;
  private pendingPromptValue: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly dependencies: LocalDictationViewDependencies,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return LOCAL_DICTATION_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return LOCAL_DICTATION_VIEW_TITLE;
  }

  override getIcon(): string {
    return LOCAL_DICTATION_VIEW_ICON;
  }

  override async onOpen(): Promise<void> {
    this.render();
    if (this.dependencies.getSettings().llmFeaturesEnabled) {
      void this.refreshModels({ silent: true });
    }
  }

  override async onClose(): Promise<void> {
    await this.flushPendingPromptSave();
  }

  private render(): void {
    const { contentEl } = this;
    const settings = this.dependencies.getSettings();

    this.focusedInput = null;
    this.promptBlurRenderPending = false;
    contentEl.empty();
    contentEl.addClass('local-dictation-sidebar');

    if (!settings.llmFeaturesEnabled) {
      return;
    }

    if (settings.llmPostprocessMode !== 'off') {
      this.lastEnabledMode = settings.llmPostprocessMode;
    }

    const cleanupGroup = createSettingGroup(contentEl, 'LLM transformation', HEADING_TOOLTIP);

    this.renderCleanupToggle(cleanupGroup, settings);
    this.renderCleanupMode(cleanupGroup, settings);

    if (settings.llmPostprocessMode === 'off') {
      return;
    }

    this.renderStylePicker(cleanupGroup, settings);
    this.renderModelPicker(cleanupGroup, settings);

    const advanced = contentEl.createEl('details', { cls: 'local-dictation-advanced' });
    advanced.createEl('summary', { text: 'Advanced' });
    advanced.open = this.advancedOpen;
    advanced.addEventListener('toggle', () => {
      this.advancedOpen = advanced.open;
    });

    this.renderContextSection(advanced, settings);
    this.renderCustomizeStyleSection(advanced, settings);
    this.renderSkipSection(advanced, settings);
    this.renderGenerationSection(advanced, settings);
    this.renderDiagnosticsSection(advanced, settings);
  }

  private renderCleanupToggle(parent: HTMLElement, settings: PluginSettings): void {
    const enabled = settings.llmPostprocessMode !== 'off';
    new Setting(parent)
      .setName('Transform')
      .setDesc(enabled ? 'LLM transform is on.' : 'Raw Whisper text is inserted directly.')
      .addToggle((toggle) => {
        toggle.setValue(enabled);
        toggle.onChange(async (value) => {
          const current = this.dependencies.getSettings();
          if (!value && isLlmPresetMode(current.llmPostprocessMode)) {
            this.lastEnabledMode = current.llmPostprocessMode;
          }
          const nextMode = value ? this.resolveModeOnEnable(current) : 'off';
          await this.saveField('llmPostprocessMode', nextMode);
        });
      });
  }

  private resolveModeOnEnable(settings: PluginSettings): LlmPresetMode {
    const activeOption = resolveStyleOption(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );
    return activeOption?.mode ?? this.lastEnabledMode;
  }

  private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
    if (settings.llmPostprocessMode === 'off') {
      return;
    }
    const activeOption = resolveStyleOption(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );
    if (activeOption !== null && activeOption.mode !== undefined) {
      // The preset declares its mode; don't show a dropdown that could create a
      // mismatch (e.g., running a batch-only summarization preset per-utterance).
      return;
    }

    const setting = new Setting(parent)
      .setName('Mode')
      .setDesc('Choose when the LLM transform runs.')
      .addDropdown((dropdown) => {
        for (const option of CLEANUP_MODE_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(settings.llmPostprocessMode);
        dropdown.onChange(async (value) => {
          if (!isLlmPresetMode(value)) {
            return;
          }
          this.lastEnabledMode = value;
          await this.saveField('llmPostprocessMode', value);
        });
      });

    appendInfoTooltip(
      setting,
      'When the LLM transform runs. "After each phrase" (per-utterance) — every spoken phrase is sent to the model as soon as Whisper finishes transcribing it, and the transformed version replaces the raw text in-line. Best for prompts that operate on one phrase at a time (filler cleanup, punctuation). "All at once on stop" (batch) — raw Whisper text is inserted while you talk, then on stop the whole session is sent to the model and replaced with the transformed result. Required for prompts that need the full context (summary, reformatting, markdown structure, brain-dump organization).',
    );
  }

  private renderStylePicker(parent: HTMLElement, settings: PluginSettings): void {
    const styleOptions = listStyleOptions(settings.llmPostprocessUserPresets);
    const activeOption = resolveStyleOption(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );
    const isCustom = activeOption === null;
    const activeRef = activeOption?.ref ?? CUSTOM_STYLE_VALUE;

    const description = isCustom
      ? 'Custom - current prompt does not match any saved preset.'
      : `${activeOption.description}${describeMode(activeOption.mode)}`;

    const setting = new Setting(parent)
      .setName('Preset')
      .setDesc(description)
      .addDropdown((dropdown) => {
        for (const option of styleOptions) {
          dropdown.addOption(option.ref, formatStyleOptionLabel(option.label, option.mode));
        }
        if (isCustom) {
          dropdown.addOption(CUSTOM_STYLE_VALUE, 'Custom');
        }
        dropdown.setValue(activeRef);
        dropdown.onChange(async (value) => {
          if (value === CUSTOM_STYLE_VALUE) {
            return;
          }
          await this.applyStyleByRef(value);
        });
      });
    appendInfoTooltip(setting, STYLE_PICKER_TOOLTIP);

    const showSave = activeOption === null;
    const showDelete = activeOption !== null && activeOption.isBuiltin === false;
    const reachedMaxCount = settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;

    if (showSave) {
      setting.addExtraButton((button) => {
        button.setIcon('save');
        if (reachedMaxCount) {
          button.setDisabled(true);
          button.setTooltip(
            `Maximum ${LLM_USER_PRESET_MAX_COUNT} presets reached. Delete one first.`,
          );
          return;
        }
        button.setTooltip('Save current prompt as a preset');
        button.onClick(() => {
          this.openSaveStyleModal();
        });
      });
    }

    if (showDelete && activeOption !== null) {
      setting.addExtraButton((button) => {
        button.setIcon('trash-2');
        button.setTooltip(`Delete preset "${activeOption.label}"`);
        button.extraSettingsEl.addClass('local-stt-preset-delete');
        button.onClick(() => {
          this.confirmDeleteUserStyle(activeOption);
        });
      });
    }
  }

  private confirmDeleteUserStyle(option: LlmStyleOption): void {
    const modal = new ConfirmModal(this.app, {
      title: 'Delete preset',
      message: `Delete preset "${option.label}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await this.deleteUserStyle(option.ref);
      },
    });
    modal.open();
  }

  private renderModelPicker(parent: HTMLElement, settings: PluginSettings): void {
    const selectedModel = settings.llmPostprocessModel;
    const hasSelectedModel =
      selectedModel.length > 0 && this.models.some((model) => model.id === selectedModel);

    const setting = new Setting(parent)
      .setName('Model')
      .setDesc('The Ollama model used to clean transcripts.')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Select a model');
        if (selectedModel.length > 0 && !hasSelectedModel) {
          dropdown.addOption(selectedModel, selectedModel);
        }
        for (const model of this.models) {
          dropdown.addOption(model.id, model.displayName);
        }
        dropdown.setValue(selectedModel);
        dropdown.onChange(async (value) => {
          const nextModel = value.trim();
          await this.saveField('llmPostprocessModel', nextModel);
          if (nextModel.length > 0) {
            void this.dependencies.ollamaClient.prewarmModel(nextModel).catch((error: unknown) => {
              this.dependencies.logger?.warn('llm', 'Ollama pre-warm failed', error);
            });
          }
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip('Refresh Ollama models')
          .onClick(() => {
            void this.refreshModels();
          });
        button.extraSettingsEl.setAttribute('aria-label', 'Refresh Ollama models');
      });

    appendInfoTooltip(
      setting,
      'Refresh re-queries Ollama for installed chat models. Smaller models are faster but less reliable.',
    );

    if (selectedModel.length === 0) {
      parent.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Pick an Ollama model to enable LLM transform. Until then, raw Whisper text is inserted directly.',
      });
    }
  }

  private async applyStyleByRef(ref: string): Promise<void> {
    const settings = this.dependencies.getSettings();
    const option = resolveStyleOption(ref, settings.llmPostprocessUserPresets);
    if (option === null) {
      return;
    }

    await this.persistSettings({
      ...settings,
      llmPostprocessActivePresetRef: option.ref,
      ...(option.mode !== undefined ? { llmPostprocessMode: option.mode } : {}),
      llmPostprocessPrompt: option.prompt,
    });
  }

  private openSaveStyleModal(): void {
    const settings = this.dependencies.getSettings();
    const existingLabels = [
      ...LLM_BUILTIN_PRESETS.map((preset) => preset.label),
      ...settings.llmPostprocessUserPresets.map((preset) => preset.label),
    ];
    const reachedMaxCount = settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;

    new SaveStyleModal(this.app, {
      defaults: {
        minWords: settings.llmPostprocessSkipMinWords,
        temperature: settings.llmPostprocessTemperature,
      },
      existingLabels,
      reachedMaxCount,
      onSave: async ({ description, label, minWords, mode, temperature }) => {
        await this.saveCurrentAsUserStyle({ description, label, minWords, mode, temperature });
      },
    }).open();
  }

  private async saveCurrentAsUserStyle(options: {
    description: string;
    label: string;
    minWords: number | null;
    mode: LlmPresetMode | null;
    temperature: number | null;
  }): Promise<void> {
    const settings = this.dependencies.getSettings();
    if (settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
      throw new Error(
        `You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one before saving a new preset.`,
      );
    }

    const id = randomUUID();
    const newPreset: LlmUserPreset = {
      description: options.description,
      id,
      label: options.label,
      ...(options.mode !== null ? { mode: options.mode } : {}),
      ...(options.minWords !== null ? { minWords: options.minWords } : {}),
      ...(options.temperature !== null ? { temperature: options.temperature } : {}),
      prompt: settings.llmPostprocessPrompt,
    };

    await this.persistSettings({
      ...settings,
      llmPostprocessActivePresetRef: formatStyleRef({ kind: 'user', id }),
      ...(options.mode !== null ? { llmPostprocessMode: options.mode } : {}),
      llmPostprocessUserPresets: [...settings.llmPostprocessUserPresets, newPreset],
    });
    if (options.mode !== null) {
      this.lastEnabledMode = options.mode;
    }
  }

  private async deleteUserStyle(ref: string): Promise<void> {
    const parsed = parseStyleRef(ref);
    if (parsed === null || parsed.kind !== 'user') {
      return;
    }

    const settings = this.dependencies.getSettings();
    const nextPresets = settings.llmPostprocessUserPresets.filter(
      (preset) => preset.id !== parsed.id,
    );
    if (nextPresets.length === settings.llmPostprocessUserPresets.length) {
      return;
    }

    const wasActive = settings.llmPostprocessActivePresetRef === ref;
    const fallbackPreset = wasActive ? getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID) : null;

    await this.persistSettings({
      ...settings,
      llmPostprocessActivePresetRef: wasActive
        ? formatStyleRef({ kind: 'builtin', id: DEFAULT_LLM_BUILTIN_PRESET_ID })
        : settings.llmPostprocessActivePresetRef,
      llmPostprocessPrompt:
        fallbackPreset !== null ? fallbackPreset.prompt : settings.llmPostprocessPrompt,
      llmPostprocessUserPresets: nextPresets,
    });
  }

  private renderContextSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Context',
      'Bounded slice of recent note text and prior utterances fed to the model so the LLM transform matches existing style and terminology.',
    );
    this.addNumberSetting(
      items,
      'Note context chars',
      'Chars of note text',
      settings.llmPostprocessNoteContextChars,
      (value) => this.saveField('llmPostprocessNoteContextChars', value, { rerender: false }),
      'Characters of surrounding note text fed to the model as context.',
    );

    if (settings.llmPostprocessMode !== 'batch') {
      this.addNumberSetting(
        items,
        'Prior utterances',
        'Recent utterances kept',
        settings.llmPostprocessPriorUtterancesN,
        (value) => this.saveField('llmPostprocessPriorUtterancesN', value, { rerender: false }),
        'Number of recent transcribed utterances included as conversation history.',
      );
    }

    this.addNumberSetting(
      items,
      'Total context cap',
      'Hard cap on context chars',
      settings.llmPostprocessTotalContextCap,
      (value) => this.saveField('llmPostprocessTotalContextCap', value, { rerender: false }),
      'Hard cap on total context characters across note and prior utterances.',
    );

    if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
      items.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Large context windows can slow local models and reduce LLM transform quality.',
      });
    }
  }

  private renderCustomizeStyleSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Prompt',
      'Edit the prompt for the current preset. Any change switches the preset picker to Custom.',
    );
    this.addTextAreaSetting(
      items,
      'Prompt',
      'LLM transform instructions',
      settings.llmPostprocessPrompt,
      10,
      (value) => {
        this.schedulePromptSave(value);
      },
      'Instructions sent as the system prompt for the local LLM transform.',
    );
  }

  private renderSkipSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Skip gates',
      'Conditions that bypass the LLM so short utterances pass straight through to the note.',
    );
    const override = activePresetOverride(settings, 'minWords');
    this.addNumberSetting(
      items,
      'Min words',
      override !== null
        ? `Set by preset "${override.label}". Delete and re-save the preset to change.`
        : 'Skip below N words',
      override?.value ?? settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip the LLM transform when the utterance has fewer words than this.',
      { disabled: override !== null },
    );
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Generation',
      'Ollama sampling parameters controlling output randomness.',
    );
    const override = activePresetOverride(settings, 'temperature');
    this.addNumberSetting(
      items,
      'Temperature',
      override !== null
        ? `Set by preset "${override.label}". Delete and re-save the preset to change.`
        : 'Sampling randomness',
      override?.value ?? settings.llmPostprocessTemperature,
      (value) => this.saveField('llmPostprocessTemperature', value, { rerender: false }),
      'Sampling randomness. 0 is deterministic; higher is more varied.',
      { disabled: override !== null },
    );
  }

  private renderDiagnosticsSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(parent, 'Diagnostics');

    if (settings.timestampsEnabled) {
      items.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Per-utterance preserves timestamps. Batch may rewrite or drop them — your prompt controls what happens.',
      });
    }

    const showRawSetting = new Setting(items)
      .setName('Show raw beneath LLM output')
      .setDesc('Keep the original Whisper transcript visible in a collapsible callout.')
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessShowRawBelow);
        toggle.onChange(async (value) => {
          await this.saveField('llmPostprocessShowRawBelow', value, { rerender: false });
        });
      });
    appendInfoTooltip(
      showRawSetting,
      'Inserts the raw Whisper text below the transformed text inside a collapsible "raw" callout. After each phrase: a small raw callout is appended under every transformed phrase. All at once on stop: one combined raw callout is appended below the transformed session text. Useful while iterating on an LLM transform prompt so you can compare the model output against what was actually said.',
    );

    new Setting(items).setName('Ollama status').setDesc(this.ollamaStatus);

    new Setting(items)
      .setName('Reset LLM defaults')
      .setDesc(
        'Restore the default prompt, mode, context, skip gates, and generation values. Your saved presets and selected model are kept.',
      )
      .addButton((button) => {
        button.setButtonText('Reset');
        button.setWarning();
        button.onClick(() => {
          this.confirmResetDefaults();
        });
      });
  }

  private confirmResetDefaults(): void {
    new ConfirmModal(this.app, {
      title: 'Reset LLM defaults',
      message:
        'Restore the default prompt, mode, context, skip gates, and generation values? Your saved presets and selected model are kept.',
      confirmLabel: 'Reset',
      destructive: true,
      onConfirm: async () => {
        await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
      },
    }).open();
  }

  private addNumberSetting(
    parent: HTMLElement,
    name: string,
    desc: string,
    value: number,
    onChange: (value: number) => Promise<void>,
    tooltip: string,
    options: { disabled?: boolean } = {},
  ): void {
    addNumberInputSetting(parent, {
      desc,
      name,
      onChange,
      onElement: (element) => {
        if (options.disabled === true) {
          element.disabled = true;
          return;
        }
        this.trackInputFocus(element);
      },
      tooltip,
      value,
    });
  }

  private addTextAreaSetting(
    parent: HTMLElement,
    name: string,
    desc: string,
    value: string,
    rows: number,
    onChange: (value: string) => void,
    tooltip: string,
  ): void {
    addTextAreaSetting(parent, {
      desc,
      name,
      onChange,
      onElement: (element) => {
        this.trackPromptBlurRender(element);
      },
      rows,
      tooltip,
      value,
    });
  }

  private schedulePromptSave(value: string): void {
    this.pendingPromptValue = value;
    if (this.promptSaveTimerId !== null) {
      clearTimeout(this.promptSaveTimerId);
    }
    this.promptSaveTimerId = setTimeout(() => {
      this.promptSaveTimerId = null;
      void this.flushPendingPromptSave();
    }, PROMPT_SAVE_DEBOUNCE_MS);
  }

  private async flushPendingPromptSave(): Promise<void> {
    if (this.promptSaveTimerId !== null) {
      clearTimeout(this.promptSaveTimerId);
      this.promptSaveTimerId = null;
    }
    const value = this.pendingPromptValue;
    if (value === null) return;
    this.pendingPromptValue = null;
    await this.savePrompt(value);
  }

  private async savePrompt(value: string): Promise<void> {
    const settings = this.dependencies.getSettings();
    if (settings.llmPostprocessPrompt === value) return;
    const activeRef = findMatchingStyleRef(value, settings.llmPostprocessUserPresets);

    await this.persistSettings(
      {
        ...settings,
        llmPostprocessActivePresetRef: activeRef,
        llmPostprocessPrompt: value,
      },
      { rerender: false },
    );
  }

  private trackInputFocus(element: HTMLElement): void {
    element.addEventListener('focus', () => {
      this.focusedInput = element;
    });
    element.addEventListener('blur', () => {
      if (this.focusedInput === element) {
        this.focusedInput = null;
      }
      this.renderAfterPromptBlurWhenIdle();
    });
  }

  // Re-render after the prompt textarea loses focus so the preset dropdown
  // flips to "Custom", but wait until the user leaves tracked input fields.
  private trackPromptBlurRender(element: HTMLElement): void {
    this.trackInputFocus(element);
    element.addEventListener('blur', () => {
      this.promptBlurRenderPending = true;
      this.renderAfterPromptBlurWhenIdle();
    });
  }

  private renderAfterPromptBlurWhenIdle(): void {
    if (!this.promptBlurRenderPending) {
      return;
    }

    window.setTimeout(() => {
      if (!this.promptBlurRenderPending) {
        return;
      }
      if (this.focusedInput?.isConnected) {
        return;
      }
      this.promptBlurRenderPending = false;
      this.render();
    }, 0);
  }

  private async refreshModels(options: { silent?: boolean } = {}): Promise<void> {
    try {
      this.models = await this.dependencies.ollamaClient.listOllamaModels();
      this.ollamaStatus =
        this.models.length === 0
          ? 'Ollama is running. No chat models found.'
          : 'Ollama is running.';
      this.render();
    } catch (error) {
      this.models = [];
      this.ollamaStatus = 'Ollama is unavailable.';
      this.dependencies.logger?.warn('llm', 'Ollama refresh failed', error);
      if (options.silent !== true) {
        this.notice('Local Dictation: Ollama is unavailable.');
      }
      this.render();
    }
  }

  private async saveField<TKey extends keyof PluginSettings>(
    key: TKey,
    value: PluginSettings[TKey],
    options: { rerender?: boolean } = {},
  ): Promise<void> {
    await this.persistSettings(
      {
        ...this.dependencies.getSettings(),
        [key]: value,
      },
      options,
    );
  }

  private async persistSettings(
    nextSettings: PluginSettings,
    options: { rerender?: boolean } = {},
  ): Promise<void> {
    await this.dependencies.saveSettings(nextSettings);
    if (options.rerender ?? true) {
      this.render();
    }
  }

  private notice(message: string): void {
    if (this.dependencies.notice !== undefined) {
      this.dependencies.notice(message);
      return;
    }
    new Notice(message);
  }
}

function activePresetOverride(
  settings: PluginSettings,
  field: 'minWords' | 'temperature',
): { label: string; value: number } | null {
  const option = resolveStyleOption(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  if (option === null) return null;
  const value = option[field];
  if (value === undefined) return null;
  return { label: option.label, value };
}

function describeMode(mode: LlmPresetMode | undefined): string {
  if (mode === 'per_utterance') {
    return ' Runs after each phrase.';
  }
  if (mode === 'batch') {
    return ' Runs once on stop.';
  }
  return ' Works in either mode.';
}

function formatStyleOptionLabel(label: string, mode: LlmPresetMode | undefined): string {
  if (mode === 'per_utterance') {
    return `${label} (per phrase)`;
  }
  if (mode === 'batch') {
    return `${label} (batch)`;
  }
  return `${label} (either)`;
}
