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
  'Uses a local Ollama model to clean up punctuation, capitalization, paragraphs, and terminology before insertion. Transcription stays local.';
const STYLE_PICKER_TOOLTIP =
  'A writing style is a saved cleanup prompt. Pick a built-in style or a saved style. Editing the prompt switches to Custom.';
const CUSTOM_STYLE_VALUE = '__custom__';

const CLEANUP_MODE_OPTIONS: ReadonlyArray<{ label: string; value: LlmPostprocessMode }> = [
  { label: 'Off', value: 'off' },
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

    appendInfoTooltip(
      new Setting(contentEl).setHeading().setName('Local AI cleanup (experimental)'),
      HEADING_TOOLTIP,
    );

    if (!settings.llmFeaturesEnabled) {
      contentEl.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Local AI cleanup is hidden. Re-enable in plugin settings -> Advanced.',
      });
      return;
    }

    this.renderCleanupMode(contentEl, settings);

    if (settings.llmPostprocessMode === 'off') {
      return;
    }

    contentEl.createEl('p', {
      cls: 'local-transcript-status',
      text: this.ollamaStatus,
    });

    new Setting(contentEl)
      .setName('Ollama models')
      .setDesc('Re-query Ollama for installed chat models.')
      .addButton((button) => {
        button.setButtonText('Refresh models');
        button.onClick(async () => {
          await this.refreshModels();
        });
      });

    new Setting(contentEl)
      .setName('Model')
      .setDesc(
        'The Ollama model used to clean transcripts. Smaller models are faster but less reliable.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Select a model');
        for (const model of this.models) {
          dropdown.addOption(model.id, model.displayName);
        }
        dropdown.setValue(settings.llmPostprocessModel);
        dropdown.onChange(async (value) => {
          const nextModel = value.trim();
          const nextSettings = {
            ...this.dependencies.getSettings(),
            llmPostprocessModel: nextModel,
          };
          await this.persistSettings(nextSettings);
          if (nextModel.length > 0) {
            void this.dependencies.ollamaClient
              .prewarmModel(nextModel, nextSettings.llmPostprocessKeepAlive)
              .catch((error: unknown) => {
                this.dependencies.logger?.warn('llm', 'Ollama pre-warm failed', error);
              });
          }
        });
      });

    this.renderStylePicker(contentEl, settings);

    if (settings.llmPostprocessMode === 'batch') {
      contentEl.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Raw text appears as you speak; cleanup runs once when you stop.',
      });
    }

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
    this.renderOutputSection(advanced, settings);

    new Setting(advanced).addButton((button) => {
      button.setButtonText('Reset LLM defaults');
      button.onClick(async () => {
        await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
      });
    });

    if (settings.llmPostprocessMode === 'per_utterance' && inFlightCount > 0) {
      const word = inFlightCount === 1 ? 'utterance' : 'utterances';
      contentEl.createEl('p', {
        cls: 'local-transcript-processing',
        text: `Cleaning ${inFlightCount} ${word}...`,
      });
    }
  }

  private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
    const setting = new Setting(parent)
      .setName('Cleanup mode')
      .setDesc('Choose when Ollama cleanup runs.')
      .addDropdown((dropdown) => {
        for (const option of CLEANUP_MODE_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(settings.llmPostprocessMode);
        dropdown.onChange(async (value) => {
          if (!isLlmPostprocessMode(value)) {
            return;
          }
          await this.saveField('llmPostprocessMode', value);
        });
      });

    appendInfoTooltip(
      setting,
      'Off inserts raw Whisper text. After each phrase cleans each utterance live. All at once inserts raw text while recording and replaces the session after stop.',
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
      ? 'Custom - current prompt does not match any saved style.'
      : `${activeOption.description}${describeMode(activeOption.mode)}`;

    const setting = new Setting(parent)
      .setName('Writing style')
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
        button.setButtonText('Save as style');
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
        `You can save up to ${LLM_USER_PRESET_MAX_COUNT} writing styles. Delete one before saving a new style.`,
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
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Context'),
      'Bounded slice of recent note text and prior utterances fed to the model so cleanup matches existing style and terminology.',
    );
    this.addNumberSetting(
      parent,
      'Note context chars',
      'Chars of note text',
      settings.llmPostprocessNoteContextChars,
      (value) => this.saveField('llmPostprocessNoteContextChars', value, { rerender: false }),
      'Characters of surrounding note text fed to the model as context.',
    );

    if (settings.llmPostprocessMode !== 'batch') {
      this.addNumberSetting(
        parent,
        'Prior utterances',
        'Recent utterances kept',
        settings.llmPostprocessPriorUtterancesN,
        (value) => this.saveField('llmPostprocessPriorUtterancesN', value, { rerender: false }),
        'Number of recent transcribed utterances included as conversation history.',
      );
    }

    this.addNumberSetting(
      parent,
      'Total context cap',
      'Hard cap on context chars',
      settings.llmPostprocessTotalContextCap,
      (value) => this.saveField('llmPostprocessTotalContextCap', value, { rerender: false }),
      'Hard cap on total context characters across note and prior utterances.',
    );

    if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
      parent.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Large context windows can slow local models and reduce cleanup quality.',
      });
    }
  }

  private renderCustomizeStyleSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Customize style'),
      'Edit the prompt for the current writing style. Any change switches the style picker to Custom.',
    );
    this.addTextAreaSetting(
      parent,
      'Prompt',
      'Cleanup instructions',
      settings.llmPostprocessPrompt,
      10,
      async (value) => {
        await this.savePrompt(value);
      },
      'Instructions sent as the system prompt for local cleanup.',
    );
  }

  private renderSkipSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Skip gates'),
      'Conditions that bypass the LLM so short utterances pass straight through to the note.',
    );
    this.addNumberSetting(
      parent,
      'Min words',
      'Skip below N words',
      settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip cleanup when the utterance has fewer words than this.',
    );
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Generation'),
      'Ollama sampling parameters controlling output randomness and how long the model stays loaded.',
    );
    this.addNumberSetting(
      parent,
      'Temperature',
      'Sampling randomness',
      settings.llmPostprocessTemperature,
      (value) => this.saveField('llmPostprocessTemperature', value, { rerender: false }),
      'Sampling randomness. 0 is deterministic; higher is more varied.',
    );
    const keepAliveSetting = new Setting(parent)
      .setName('Keep alive')
      .setDesc('Model load duration (e.g. 30m)')
      .addText((text) => {
        text.setValue(settings.llmPostprocessKeepAlive);
        this.trackInputFocus(text.inputEl);
        text.onChange(async (value) => {
          await this.saveField('llmPostprocessKeepAlive', value, { rerender: false });
        });
      });
    appendInfoTooltip(
      keepAliveSetting,
      'How long Ollama keeps the model loaded after each request (e.g. 30m, 1h).',
    );
  }

  private renderOutputSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Output'),
      'How the cleaned and raw transcripts are surfaced in the note.',
    );
    const showRawSetting = new Setting(parent)
      .setName('Show raw beneath LLM output')
      .setDesc('Append raw below cleaned')
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessShowRawBelow);
        toggle.onChange(async (value) => {
          await this.saveField('llmPostprocessShowRawBelow', value, { rerender: false });
        });
      });
    appendInfoTooltip(
      showRawSetting,
      'Append the original transcript below the cleaned version in the note.',
    );
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
  return '';
}

function formatStyleOptionLabel(label: string, mode: LlmPresetMode | undefined): string {
  if (mode === 'per_utterance') {
    return `${label} (per phrase)`;
  }
  if (mode === 'batch') {
    return `${label} (batch)`;
  }
  return label;
}
