import { ItemView, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import type { OllamaClient, OllamaModelOption } from '../llm/ollama-client';
import { type PluginSettings, resetLlmPostprocessDefaults } from '../settings/plugin-settings';
import type { PluginLogger } from '../shared/plugin-logger';
import type { SessionState, SidecarEvent } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';

export const LOCAL_TRANSCRIPT_VIEW_TYPE = 'local-transcript-sidebar';
const LOCAL_TRANSCRIPT_VIEW_TITLE = 'Local Transcript';
const LOCAL_TRANSCRIPT_VIEW_ICON = 'audio-lines';
const OLLAMA_ENABLE_FAILURE_NOTICE = 'Start Ollama, then enable LLM post-processing again.';
const MODEL_REQUIRED_NOTICE = 'Select an Ollama model, then enable LLM post-processing again.';
const MODEL_MISSING_NOTICE =
  'Refresh models, select an installed model, then enable LLM post-processing again.';
const EXPECTATIONS_TEXT =
  'Local LLM cleanup is experimental. The reliable wins are punctuation, casing, paragraph structure, and terminology fidelity. Word-error-rate reduction is not guaranteed and may be negative on already-clean speech. If output regresses, raise the skip-confidence threshold or simplify the prompt.';

interface LocalTranscriptViewDependencies {
  getSettings: () => PluginSettings;
  logger?: PluginLogger | undefined;
  notice?: (message: string) => void;
  ollamaClient: OllamaClient;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'subscribe'>;
}

export class LocalTranscriptView extends ItemView {
  private focusedTextArea: HTMLTextAreaElement | null = null;
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
    const timestampsEnabled = settings.showTimestamps;
    const inFlightCount = this.queueDepth + (this.sessionState === 'transcribing' ? 1 : 0);

    this.focusedTextArea = null;
    contentEl.empty();
    contentEl.addClass('local-transcript-sidebar');

    new Setting(contentEl).setHeading().setName('LLM post-processing');
    contentEl.createEl('p', {
      cls: 'local-transcript-preamble',
      text: EXPECTATIONS_TEXT,
    });

    new Setting(contentEl).setName('Enable').addToggle((toggle) => {
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

    new Setting(contentEl).setName('Ollama models').addButton((button) => {
      button.setButtonText('Refresh models');
      button.onClick(async () => {
        await this.refreshModels({ disableOnFailure: settings.llmPostprocessEnabled });
      });
    });

    new Setting(contentEl).setName('Model').addDropdown((dropdown) => {
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

    this.renderContextSection(contentEl, settings);
    this.renderPromptSection(contentEl, settings);
    this.renderSkipSection(contentEl, settings);
    this.renderGenerationSection(contentEl, settings);
    this.renderDisplaySection(contentEl, settings, timestampsEnabled);

    new Setting(contentEl).addButton((button) => {
      button.setButtonText('Reset LLM defaults');
      button.onClick(async () => {
        await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
      });
    });

    if (settings.llmPostprocessEnabled && inFlightCount > 0) {
      contentEl.createEl('p', {
        cls: 'local-transcript-processing',
        text: `Processing ${inFlightCount} utterance(s)...`,
      });
    }
  }

  private renderContextSection(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent).setHeading().setName('Context');
    this.addNumberSetting(parent, 'Note context chars', settings.llmPostprocessNoteContextChars, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessNoteContextChars', value);
      },
    });
    this.addNumberSetting(parent, 'Prior utterances', settings.llmPostprocessPriorUtterancesN, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessPriorUtterancesN', value);
      },
    });
    this.addNumberSetting(parent, 'Glossary context chars', settings.llmPostprocessGlossaryChars, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessGlossaryChars', value);
      },
    });
    this.addNumberSetting(parent, 'Total context cap', settings.llmPostprocessTotalContextCap, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessTotalContextCap', value);
      },
    });

    if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
      parent.createEl('p', {
        cls: 'local-transcript-muted',
        text: 'Large context windows can slow local models and reduce cleanup quality.',
      });
    }
  }

  private renderPromptSection(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent).setHeading().setName('Prompt Slots');
    this.addTextAreaSetting(parent, 'System slot', settings.llmPostprocessSystemSlot, {
      rows: 5,
      onChange: async (value) => {
        await this.saveField('llmPostprocessSystemSlot', value, { rerender: false });
      },
    });
    this.addTextAreaSetting(parent, 'Voice slot', settings.llmPostprocessVoiceSlot, {
      rows: 4,
      onChange: async (value) => {
        await this.saveField('llmPostprocessVoiceSlot', value, { rerender: false });
      },
    });
    this.addTextAreaSetting(parent, 'Glossary slot', settings.llmPostprocessGlossarySlot, {
      rows: 5,
      onChange: async (value) => {
        await this.saveField('llmPostprocessGlossarySlot', value, { rerender: false });
      },
    });
    this.addTextAreaSetting(parent, 'Format slot', settings.llmPostprocessFormatSlot, {
      rows: 4,
      onChange: async (value) => {
        await this.saveField('llmPostprocessFormatSlot', value, { rerender: false });
      },
    });
    this.addTextAreaSetting(parent, 'User template', settings.llmPostprocessUserTemplate, {
      rows: 12,
      onChange: async (value) => {
        await this.saveField('llmPostprocessUserTemplate', value, { rerender: false });
      },
    });
  }

  private renderSkipSection(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent).setHeading().setName('Skip Gates');
    this.addNumberSetting(parent, 'Min words', settings.llmPostprocessSkipMinWords, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessSkipMinWords', value);
      },
    });
    new Setting(parent).setName('Skip if avg logprob above').addText((text) => {
      text.setValue(settings.llmPostprocessSkipIfAvgLogprobAbove?.toString() ?? '');
      text.onChange(async (value) => {
        const trimmed = value.trim();
        await this.saveField(
          'llmPostprocessSkipIfAvgLogprobAbove',
          trimmed.length === 0 ? null : Number(trimmed),
        );
      });
    });
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent).setHeading().setName('Generation');
    this.addNumberSetting(parent, 'Temperature', settings.llmPostprocessTemperature, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessTemperature', value);
      },
    });
    this.addNumberSetting(parent, 'Max predictions', settings.llmPostprocessNumPredict, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessNumPredict', value);
      },
    });
    this.addNumberSetting(parent, 'Seed', settings.llmPostprocessSeed, {
      onChange: async (value) => {
        await this.saveField('llmPostprocessSeed', value);
      },
    });
    new Setting(parent).setName('Keep alive').addText((text) => {
      text.setValue(settings.llmPostprocessKeepAlive);
      text.onChange(async (value) => {
        await this.saveField('llmPostprocessKeepAlive', value);
      });
    });
  }

  private renderDisplaySection(
    parent: HTMLElement,
    settings: PluginSettings,
    timestampsEnabled: boolean,
  ): void {
    new Setting(parent).setHeading().setName('Display');
    new Setting(parent).setName('Show raw beneath LLM output').addToggle((toggle) => {
      toggle.setValue(settings.llmPostprocessShowRawBelow);
      toggle.setDisabled(timestampsEnabled);
      toggle.onChange(async (value) => {
        await this.saveField('llmPostprocessShowRawBelow', value);
      });
    });
  }

  private addNumberSetting(
    parent: HTMLElement,
    name: string,
    value: number,
    options: { onChange: (value: number) => Promise<void> },
  ): void {
    new Setting(parent).setName(name).addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(value.toString());
      text.onChange(async (nextValue) => {
        await options.onChange(Number(nextValue));
      });
    });
  }

  private addTextAreaSetting(
    parent: HTMLElement,
    name: string,
    value: string,
    options: { onChange: (value: string) => Promise<void>; rows: number },
  ): void {
    new Setting(parent).setName(name).addTextArea((text) => {
      text.inputEl.rows = options.rows;
      text.setValue(value);
      text.inputEl.addEventListener('focus', () => {
        this.focusedTextArea = text.inputEl;
      });
      text.inputEl.addEventListener('blur', () => {
        this.focusedTextArea = null;
        this.render();
      });
      text.onChange(options.onChange);
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
      void this.dependencies.ollamaClient.prewarmModel(selectedModel).catch((error: unknown) => {
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
      this.renderIfTextAreaIsNotFocused();
      return;
    }

    if (event.type === 'session_state_changed') {
      this.sessionState = event.state;
      this.renderIfTextAreaIsNotFocused();
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

  private renderIfTextAreaIsNotFocused(): void {
    if (this.focusedTextArea !== null && document.activeElement === this.focusedTextArea) {
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
