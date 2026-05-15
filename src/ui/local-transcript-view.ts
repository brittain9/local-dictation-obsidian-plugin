import { ItemView, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import type { OllamaClient, OllamaModelOption } from '../llm/ollama-client';
import { DEFAULT_LLM_PRESET_ID, LLM_PRESETS, type LlmPresetId } from '../llm/presets';
import { type PluginSettings, resetLlmPostprocessDefaults } from '../settings/plugin-settings';
import type { PluginLogger } from '../shared/plugin-logger';
import type { SessionState, SidecarEvent } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { appendInfoTooltip } from './info-tooltip';

export const LOCAL_TRANSCRIPT_VIEW_TYPE = 'local-transcript-sidebar';
const LOCAL_TRANSCRIPT_VIEW_TITLE = 'Local Transcript';
const LOCAL_TRANSCRIPT_VIEW_ICON = 'audio-lines';
const OLLAMA_ENABLE_FAILURE_NOTICE = 'Start Ollama, then enable LLM post-processing again.';
const MODEL_REQUIRED_NOTICE = 'Select an Ollama model, then enable LLM post-processing again.';
const MODEL_MISSING_NOTICE =
  'Refresh models, select an installed model, then enable LLM post-processing again.';
const HEADING_TOOLTIP =
  'Sends each transcribed utterance to a local Ollama model to clean up punctuation, capitalization, paragraphs, and terminology before insertion. Disable if quality drops.';

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
  private pendingPresetId: LlmPresetId = DEFAULT_LLM_PRESET_ID;
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
    const timestampsEnabled = settings.showTimestamps;
    const inFlightCount = this.queueDepth + (this.sessionState === 'transcribing' ? 1 : 0);

    this.focusedInput = null;
    contentEl.empty();
    contentEl.addClass('local-transcript-sidebar');

    appendInfoTooltip(
      new Setting(contentEl).setHeading().setName('LLM post-processing (experimental)'),
      HEADING_TOOLTIP,
    );

    new Setting(contentEl)
      .setName('Enable')
      .setDesc('Run each utterance through the selected Ollama model before it lands in the note.')
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessEnabled);
        toggle.onChange(async (enabled) => {
          await this.handleEnableChanged(enabled);
        });
      });

    if (timestampsEnabled) {
      contentEl.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Disabled while timestamps are enabled.',
      });
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
          await this.refreshModels({ disableOnFailure: settings.llmPostprocessEnabled });
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
          await this.persistSettings({
            ...this.dependencies.getSettings(),
            llmPostprocessModel: value.trim(),
          });
        });
      });

    const advanced = contentEl.createEl('details', { cls: 'local-transcript-advanced' });
    advanced.createEl('summary', { text: 'Advanced' });
    advanced.open = this.advancedOpen;
    advanced.addEventListener('toggle', () => {
      this.advancedOpen = advanced.open;
    });

    this.renderContextSection(advanced, settings);
    this.renderPromptSection(advanced, settings);
    this.renderSkipSection(advanced, settings);
    this.renderGenerationSection(advanced, settings);
    this.renderOutputSection(advanced, settings, timestampsEnabled);

    new Setting(advanced).addButton((button) => {
      button.setButtonText('Reset LLM defaults');
      button.onClick(async () => {
        await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
      });
    });

    if (settings.llmPostprocessEnabled && inFlightCount > 0) {
      const word = inFlightCount === 1 ? 'utterance' : 'utterances';
      contentEl.createEl('p', {
        cls: 'local-transcript-processing',
        text: `Cleaning ${inFlightCount} ${word}…`,
      });
    }
  }

  private renderContextSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Context'),
      'Bounded slice of recent note text, prior utterances, and glossary fed to the model so cleanup matches existing style and terminology.',
    );
    this.addNumberSetting(
      parent,
      'Note context chars',
      'Chars of note text',
      settings.llmPostprocessNoteContextChars,
      (value) => this.saveField('llmPostprocessNoteContextChars', value, { rerender: false }),
      'Characters of surrounding note text fed to the model as context.',
    );
    this.addNumberSetting(
      parent,
      'Prior utterances',
      'Recent utterances kept',
      settings.llmPostprocessPriorUtterancesN,
      (value) => this.saveField('llmPostprocessPriorUtterancesN', value, { rerender: false }),
      'Number of recent transcribed utterances included as conversation history.',
    );
    this.addNumberSetting(
      parent,
      'Total context cap',
      'Hard cap on context chars',
      settings.llmPostprocessTotalContextCap,
      (value) => this.saveField('llmPostprocessTotalContextCap', value, { rerender: false }),
      'Hard cap on total context characters across note + utterances + glossary.',
    );
    this.addTextAreaSetting(
      parent,
      'Glossary',
      'Proper nouns and spellings',
      settings.llmPostprocessGlossarySlot,
      5,
      (value) => this.saveField('llmPostprocessGlossarySlot', value, { rerender: false }),
      'Proper nouns, names, and preferred spellings the model should preserve. Leave blank to omit.',
    );
    this.addNumberSetting(
      parent,
      'Glossary char cap',
      'Max glossary chars',
      settings.llmPostprocessGlossaryChars,
      (value) => this.saveField('llmPostprocessGlossaryChars', value, { rerender: false }),
      'Maximum characters of glossary text fed to the model. Longer glossaries are truncated.',
    );

    if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
      parent.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Large context windows can slow local models and reduce cleanup quality.',
      });
    }
  }

  private renderPromptSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Prompt'),
      'Building blocks of the prompt sent to Ollama. The user prompt template combines system role, voice, glossary, and format hints with each utterance.',
    );
    this.renderPresetPicker(parent);
    this.addTextAreaSetting(
      parent,
      'System prompt',
      'Model role + rules',
      settings.llmPostprocessSystemSlot,
      5,
      (value) => this.saveField('llmPostprocessSystemSlot', value, { rerender: false }),
      'Sets the model role and the rules it must follow when rewriting.',
    );
    this.addTextAreaSetting(
      parent,
      'Voice & style',
      'Speaker voice + tone',
      settings.llmPostprocessVoiceSlot,
      4,
      (value) => this.saveField('llmPostprocessVoiceSlot', value, { rerender: false }),
      'Hints about the speaker voice and tone.',
    );
    this.addTextAreaSetting(
      parent,
      'Output format',
      'Output format constraints',
      settings.llmPostprocessFormatSlot,
      4,
      (value) => this.saveField('llmPostprocessFormatSlot', value, { rerender: false }),
      'Output format constraints (e.g. plain text, no markdown).',
    );
    this.addTextAreaSetting(
      parent,
      'User prompt template',
      'Per-utterance prompt',
      settings.llmPostprocessUserTemplate,
      12,
      (value) => this.saveField('llmPostprocessUserTemplate', value, { rerender: false }),
      'Per-utterance prompt with placeholders for context, prior text, glossary, and the raw transcript.',
    );
  }

  private renderSkipSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Skip gates'),
      'Conditions that bypass the LLM so short or high-confidence utterances pass straight through to the note.',
    );
    this.addNumberSetting(
      parent,
      'Min words',
      'Skip below N words',
      settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip cleanup when the utterance has fewer words than this.',
    );
    const logprobSetting = new Setting(parent)
      .setName('Skip if avg logprob above')
      .setDesc('Confidence threshold (blank = always run)')
      .addText((text) => {
        text.setValue(settings.llmPostprocessSkipIfAvgLogprobAbove?.toString() ?? '');
        this.trackInputFocus(text.inputEl);
        text.onChange(async (value) => {
          const trimmed = value.trim();
          await this.saveField(
            'llmPostprocessSkipIfAvgLogprobAbove',
            trimmed.length === 0 ? null : Number(trimmed),
            { rerender: false },
          );
        });
      });
    appendInfoTooltip(
      logprobSetting,
      'Skip cleanup when ASR confidence (average log-probability) is above this. Blank to never skip on confidence.',
    );
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Generation'),
      'Ollama sampling parameters controlling output randomness, length, seed, and how long the model stays loaded.',
    );
    this.addNumberSetting(
      parent,
      'Temperature',
      'Sampling randomness',
      settings.llmPostprocessTemperature,
      (value) => this.saveField('llmPostprocessTemperature', value, { rerender: false }),
      'Sampling randomness. 0 is deterministic; higher is more varied.',
    );
    this.addNumberSetting(
      parent,
      'Max predictions',
      'Max tokens per utterance',
      settings.llmPostprocessNumPredict,
      (value) => this.saveField('llmPostprocessNumPredict', value, { rerender: false }),
      'Maximum tokens the model can generate per utterance.',
    );
    this.addNumberSetting(
      parent,
      'Seed',
      'Reproducibility seed',
      settings.llmPostprocessSeed,
      (value) => this.saveField('llmPostprocessSeed', value, { rerender: false }),
      'Random seed. Same seed + input + model produces the same output.',
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

  private renderOutputSection(
    parent: HTMLElement,
    settings: PluginSettings,
    timestampsEnabled: boolean,
  ): void {
    appendInfoTooltip(
      new Setting(parent).setHeading().setName('Output'),
      'How the cleaned and raw transcripts are surfaced in the note.',
    );
    const showRawSetting = new Setting(parent)
      .setName('Show raw beneath LLM output')
      .setDesc('Append raw below cleaned')
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessShowRawBelow);
        toggle.setDisabled(timestampsEnabled);
        toggle.onChange(async (value) => {
          await this.saveField('llmPostprocessShowRawBelow', value, { rerender: false });
        });
      });
    appendInfoTooltip(
      showRawSetting,
      'Append the original transcript below the cleaned version in the note.',
    );
  }

  private renderPresetPicker(parent: HTMLElement): void {
    const setting = new Setting(parent)
      .setName('Preset')
      .setDesc('Apply a named bundle of prompt settings.')
      .addDropdown((dropdown) => {
        for (const preset of LLM_PRESETS) {
          dropdown.addOption(preset.id, preset.label);
        }
        dropdown.setValue(this.pendingPresetId);
        dropdown.onChange((value) => {
          this.pendingPresetId = value as LlmPresetId;
        });
      })
      .addButton((button) => {
        button.setButtonText('Apply');
        button.onClick(async () => {
          const preset = LLM_PRESETS.find((entry) => entry.id === this.pendingPresetId);
          if (preset === undefined) {
            return;
          }
          await this.persistSettings({
            ...this.dependencies.getSettings(),
            llmPostprocessFormatSlot: preset.formatSlot,
            llmPostprocessSystemSlot: preset.systemSlot,
            llmPostprocessUserTemplate: preset.userTemplate,
            llmPostprocessVoiceSlot: preset.voiceSlot,
          });
        });
      });
    appendInfoTooltip(
      setting,
      'Pick a preset and click Apply to overwrite the system prompt, voice, format, and user template. Edits made afterward are yours.',
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

  private trackInputFocus(element: HTMLElement): void {
    element.addEventListener('focus', () => {
      this.focusedInput = element;
    });
    element.addEventListener('blur', () => {
      this.focusedInput = null;
      // Defer so a follow-up focus on another tracked input wins before the
      // re-render destroys it (browsers fire blur on A then focus on B).
      window.setTimeout(() => {
        if (this.focusedInput === null) {
          this.render();
        }
      }, 0);
    });
  }

  private async handleEnableChanged(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.saveField('llmPostprocessEnabled', false);
      return;
    }

    try {
      await this.refreshModels({ disableOnFailure: false, rerender: false });
      const settings = this.dependencies.getSettings();
      const selectedModel = settings.llmPostprocessModel.trim();

      if (selectedModel.length === 0) {
        await this.persistSettings({ ...settings, llmPostprocessEnabled: false });
        this.notice(MODEL_REQUIRED_NOTICE);
        return;
      }

      if (!this.models.some((model) => model.id === selectedModel)) {
        await this.persistSettings({ ...settings, llmPostprocessEnabled: false });
        this.notice(MODEL_MISSING_NOTICE);
        return;
      }

      await this.persistSettings({ ...settings, llmPostprocessEnabled: true });
      void this.dependencies.ollamaClient
        .prewarmModel(selectedModel, settings.llmPostprocessKeepAlive)
        .catch((error: unknown) => {
          this.dependencies.logger?.warn('llm', 'Ollama pre-warm failed', error);
          this.notice('Local Transcript: Ollama pre-warm failed.');
        });
    } catch (error) {
      this.dependencies.logger?.warn('llm', 'Ollama preflight failed', error);
      await this.persistSettings({
        ...this.dependencies.getSettings(),
        llmPostprocessEnabled: false,
      });
      this.notice(OLLAMA_ENABLE_FAILURE_NOTICE);
    }
  }

  private async refreshModels(options: {
    disableOnFailure: boolean;
    rerender?: boolean;
  }): Promise<void> {
    try {
      await this.dependencies.ollamaClient.probeOllama();
      this.models = await this.dependencies.ollamaClient.listOllamaModels();
      this.ollamaStatus =
        this.models.length === 0
          ? 'Ollama is running. No chat models found.'
          : 'Ollama is running.';
      if (options.rerender ?? true) {
        this.render();
      }
    } catch (error) {
      this.models = [];
      this.ollamaStatus = 'Ollama is unavailable.';
      if (options.disableOnFailure) {
        await this.persistSettings({
          ...this.dependencies.getSettings(),
          llmPostprocessEnabled: false,
        });
        this.notice(OLLAMA_ENABLE_FAILURE_NOTICE);
      } else if (options.rerender ?? true) {
        this.render();
      }
      throw error;
    }
  }

  private handleSidecarEvent(event: SidecarEvent): void {
    if (event.type === 'transcription_queue_changed') {
      this.queueDepth = event.queuedUtterances;
      this.renderIfInputNotFocused();
      return;
    }

    if (event.type === 'session_state_changed') {
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
