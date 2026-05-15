import { randomUUID } from 'node:crypto';

import { ItemView, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import type { OllamaClient, OllamaModelOption } from '../llm/ollama-client';
import {
  findMatchingStyleRef,
  formatStyleRef,
  type LlmPresetMode,
  type LlmUserPreset,
  listStyleOptions,
  parseStyleRef,
  resolveStyleOption,
} from '../llm/presets';
import {
  isLlmPostprocessMode,
  LLM_USER_PRESET_MAX_COUNT,
  type LlmPostprocessMode,
  type PluginSettings,
  resetLlmPostprocessDefaults,
} from '../settings/plugin-settings';
import type { PluginLogger } from '../shared/plugin-logger';
import type { SessionState, SidecarEvent } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { appendInfoTooltip } from './info-tooltip';
import { SaveStyleModal } from './save-style-modal';

export const LOCAL_TRANSCRIPT_VIEW_TYPE = 'local-transcript-sidebar';
const LOCAL_TRANSCRIPT_VIEW_TITLE = 'Local Transcript';
const LOCAL_TRANSCRIPT_VIEW_ICON = 'audio-lines';
const HEADING_TOOLTIP =
  'Uses a local Ollama model to transform the dictated transcript — cleaning, rewriting, summarizing, reformatting, or running custom prompts. Transcription stays local.';
const STYLE_PICKER_TOOLTIP =
  'A preset is a saved LLM transform prompt. Pick a built-in preset or a saved preset. Editing the prompt switches to Custom. The suffix after each preset name shows which mode it is meant for: (per phrase) runs after every spoken phrase, (batch) runs once when you stop, (either) works in both — picking a (per phrase) or (batch) preset will switch the mode for you.';
const CUSTOM_STYLE_VALUE = '__custom__';

type EnabledLlmPostprocessMode = Exclude<LlmPostprocessMode, 'off'>;

const DEFAULT_ENABLED_CLEANUP_MODE: EnabledLlmPostprocessMode = 'per_utterance';

const CLEANUP_MODE_OPTIONS: ReadonlyArray<{ label: string; value: EnabledLlmPostprocessMode }> = [
  { label: 'After each phrase', value: 'per_utterance' },
  { label: 'All at once on stop', value: 'batch' },
];

interface LocalTranscriptViewDependencies {
  getSettings: () => PluginSettings;
  logger?: PluginLogger | undefined;
  notice?: (message: string) => void;
  ollamaClient: OllamaClient;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'subscribe'>;
}

export class LocalTranscriptView extends ItemView {
  private advancedOpen = false;
  private focusedInput: HTMLElement | null = null;
  private models: OllamaModelOption[] = [];
  private ollamaStatus = 'Ollama status unknown.';
  private lastEnabledMode: EnabledLlmPostprocessMode = DEFAULT_ENABLED_CLEANUP_MODE;
  private queueDepth = 0;
  private releaseSidecarSubscription: (() => void) | null = null;
  private sessionState: SessionState = 'idle';

  constructor(
    leaf: WorkspaceLeaf,
    private readonly dependencies: LocalTranscriptViewDependencies,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return LOCAL_TRANSCRIPT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return LOCAL_TRANSCRIPT_VIEW_TITLE;
  }

  override getIcon(): string {
    return LOCAL_TRANSCRIPT_VIEW_ICON;
  }

  override async onOpen(): Promise<void> {
    this.releaseSidecarSubscription = this.dependencies.sidecarConnection.subscribe((event) => {
      this.handleSidecarEvent(event);
    });
    this.render();
  }

  override async onClose(): Promise<void> {
    this.releaseSidecarSubscription?.();
    this.releaseSidecarSubscription = null;
  }

  private render(): void {
    const { contentEl } = this;
    const settings = this.dependencies.getSettings();
    const inFlightCount = this.queueDepth + (this.sessionState === 'transcribing' ? 1 : 0);

    this.focusedInput = null;
    contentEl.empty();
    contentEl.addClass('local-transcript-sidebar');

    if (!settings.llmFeaturesEnabled) {
      return;
    }

    if (settings.llmPostprocessMode !== 'off') {
      this.lastEnabledMode = settings.llmPostprocessMode;
    }

    const cleanupGroup = this.createSettingGroup(contentEl, 'LLM transformation', HEADING_TOOLTIP);

    this.renderCleanupToggle(cleanupGroup, settings);
    this.renderCleanupMode(cleanupGroup, settings);

    if (settings.llmPostprocessMode === 'off') {
      return;
    }

    this.renderStylePicker(cleanupGroup, settings);
    this.renderModelPicker(cleanupGroup, settings);

    const advanced = contentEl.createEl('details', { cls: 'local-transcript-advanced' });
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

    if (settings.llmPostprocessMode === 'per_utterance' && inFlightCount > 0) {
      const word = inFlightCount === 1 ? 'utterance' : 'utterances';
      contentEl.createEl('p', {
        cls: 'local-transcript-processing',
        text: `Cleaning ${inFlightCount} ${word}...`,
      });
    }
  }

  private renderCleanupToggle(parent: HTMLElement, settings: PluginSettings): void {
    const enabled = settings.llmPostprocessMode !== 'off';
    new Setting(parent)
      .setName('Transform')
      .setDesc(enabled ? 'LLM transform is on.' : 'Raw Whisper text is inserted directly.')
      .addToggle((toggle) => {
        toggle.setValue(enabled);
        toggle.onChange(async (value) => {
          if (!value && this.dependencies.getSettings().llmPostprocessMode !== 'off') {
            this.lastEnabledMode = this.dependencies.getSettings()
              .llmPostprocessMode as EnabledLlmPostprocessMode;
          }
          await this.saveField('llmPostprocessMode', value ? this.lastEnabledMode : 'off');
        });
      });
  }

  private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
    if (settings.llmPostprocessMode === 'off') {
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
          if (!isLlmPostprocessMode(value) || value === 'off') {
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

    const showSaveAs = activeOption === null || activeOption.isBuiltin === false;
    const showDelete = activeOption !== null && activeOption.isBuiltin === false;

    if (showSaveAs) {
      setting.addButton((button) => {
        button.setButtonText('Save preset');
        button.onClick(() => {
          this.openSaveStyleModal();
        });
      });
    }

    if (showDelete && activeOption !== null) {
      setting.addButton((button) => {
        button.setButtonText('Delete');
        button.setWarning();
        button.onClick(async () => {
          await this.deleteUserStyle(activeOption.ref);
        });
      });
    }
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
      .addButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip('Refresh Ollama models')
          .onClick(async () => {
            await this.refreshModels();
          });
      });

    appendInfoTooltip(
      setting,
      'Refresh re-queries Ollama for installed chat models. Smaller models are faster but less reliable.',
    );
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
    const existingLabels = settings.llmPostprocessUserPresets.map((preset) => preset.label);
    const reachedMaxCount = settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;

    new SaveStyleModal(this.app, {
      existingLabels,
      reachedMaxCount,
      onSave: async ({ description, label, mode }) => {
        await this.saveCurrentAsUserStyle({ description, label, mode });
      },
    }).open();
  }

  private async saveCurrentAsUserStyle(options: {
    description: string;
    label: string;
    mode: LlmPresetMode | null;
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
      prompt: settings.llmPostprocessPrompt,
    };

    await this.persistSettings({
      ...settings,
      llmPostprocessActivePresetRef: formatStyleRef({ kind: 'user', id }),
      llmPostprocessUserPresets: [...settings.llmPostprocessUserPresets, newPreset],
    });
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

    await this.persistSettings({
      ...settings,
      llmPostprocessActivePresetRef: wasActive ? null : settings.llmPostprocessActivePresetRef,
      llmPostprocessUserPresets: nextPresets,
    });
  }

  private renderContextSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = this.createSettingGroup(
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
        cls: 'local-transcript-muted',
        text: 'Large context windows can slow local models and reduce LLM transform quality.',
      });
    }
  }

  private renderCustomizeStyleSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = this.createSettingGroup(
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
      async (value) => {
        await this.savePrompt(value);
      },
      'Instructions sent as the system prompt for the local LLM transform.',
    );
  }

  private renderSkipSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = this.createSettingGroup(
      parent,
      'Skip gates',
      'Conditions that bypass the LLM so short utterances pass straight through to the note.',
    );
    this.addNumberSetting(
      items,
      'Min words',
      'Skip below N words',
      settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip the LLM transform when the utterance has fewer words than this.',
    );
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = this.createSettingGroup(
      parent,
      'Generation',
      'Ollama sampling parameters controlling output randomness.',
    );
    this.addNumberSetting(
      items,
      'Temperature',
      'Sampling randomness',
      settings.llmPostprocessTemperature,
      (value) => this.saveField('llmPostprocessTemperature', value, { rerender: false }),
      'Sampling randomness. 0 is deterministic; higher is more varied.',
    );
  }

  private renderDiagnosticsSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = this.createSettingGroup(parent, 'Diagnostics');

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

    new Setting(items)
      .setName('Ollama status')
      .setDesc(this.ollamaStatus)
      .addButton((button) => {
        button.setButtonText('Reset LLM defaults');
        button.onClick(async () => {
          await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
        });
      });
  }

  private createSettingGroup(parent: HTMLElement, heading: string, tooltip?: string): HTMLDivElement {
    const group = parent.createDiv({ cls: 'setting-group' });
    const headingSetting = new Setting(group).setName(heading).setHeading();
    if (tooltip !== undefined) {
      appendInfoTooltip(headingSetting, tooltip);
    }
    return group.createDiv({ cls: 'setting-items' });
  }

  private addNumberSetting(
    parent: HTMLElement,
    name: string,
    desc: string,
    value: number,
    onChange: (value: number) => Promise<void>,
    tooltip: string,
  ): void {
    const setting = new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(value.toString());
        this.trackInputFocus(text.inputEl);
        text.onChange(async (nextValue) => {
          await onChange(Number(nextValue));
        });
      });
    appendInfoTooltip(setting, tooltip);
  }

  private addTextAreaSetting(
    parent: HTMLElement,
    name: string,
    desc: string,
    value: string,
    rows: number,
    onChange: (value: string) => Promise<void>,
    tooltip: string,
  ): void {
    const setting = new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addTextArea((text) => {
        text.inputEl.rows = rows;
        text.setValue(value);
        this.trackInputFocus(text.inputEl);
        text.onChange(onChange);
      });
    appendInfoTooltip(setting, tooltip);
  }

  private async savePrompt(value: string): Promise<void> {
    const settings = this.dependencies.getSettings();
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
      this.focusedInput = null;
      window.setTimeout(() => {
        if (this.focusedInput === null) {
          this.render();
        }
      }, 0);
    });
  }

  private async refreshModels(): Promise<void> {
    try {
      await this.dependencies.ollamaClient.probeOllama();
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
      this.notice('Local Transcript: Ollama is unavailable.');
      this.render();
    }
  }

  private handleSidecarEvent(event: SidecarEvent): void {
    if (event.type === 'transcription_queue_changed') {
      if (this.queueDepth === event.queuedUtterances) {
        return;
      }
      this.queueDepth = event.queuedUtterances;
      this.renderIfInputNotFocused();
      return;
    }

    if (event.type === 'session_state_changed') {
      if (this.sessionState === event.state) {
        return;
      }
      this.sessionState = event.state;
      this.renderIfInputNotFocused();
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

  private renderIfInputNotFocused(): void {
    if (this.focusedInput !== null && document.activeElement === this.focusedInput) {
      return;
    }
    this.render();
  }

  private notice(message: string): void {
    if (this.dependencies.notice !== undefined) {
      this.dependencies.notice(message);
      return;
    }
    new Notice(message);
  }
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
