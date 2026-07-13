import type { App, ButtonComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  LLM_MIN_WORDS_MAX,
  LLM_PRIOR_UTTERANCES_MAX,
  LLM_TEMPERATURE_MAX,
  LLM_TOTAL_CONTEXT_CAP_MAX,
  MAX_LLM_REMOTE_TIMEOUT_SEC,
  MIN_LLM_REMOTE_TIMEOUT_SEC,
  type PluginSettings,
} from '../settings/plugin-settings';
import { createSettingGroup } from '../settings/setting-helpers';
import { ConfirmModal } from './confirm-modal';
import { activePresetOverride } from './llm-preset-overrides';

interface LlmTransformSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  resetDefaults: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

type LlmTransformSettingsDraft = Pick<
  PluginSettings,
  | 'llmPostprocessPriorUtterancesN'
  | 'llmPostprocessShowRawBelow'
  | 'llmPostprocessSkipMinWords'
  | 'llmPostprocessTemperature'
  | 'llmPostprocessTotalContextCap'
  | 'llmRemoteTimeoutSec'
>;

type LlmTransformNumberField = Exclude<
  keyof LlmTransformSettingsDraft,
  'llmPostprocessShowRawBelow'
>;

interface NumberSettingOptions<TKey extends LlmTransformNumberField> {
  desc: string;
  disabled?: boolean;
  displayValue?: number;
  integer?: boolean;
  key: TKey;
  max: number;
  min: number;
  name: string;
  step?: number;
}

export class LlmTransformSettingsModal extends Modal {
  private draft: LlmTransformSettingsDraft;
  private readonly invalidFields = new Set<LlmTransformNumberField>();
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly deps: LlmTransformSettingsModalDependencies,
  ) {
    super(app);
    this.draft = draftFromSettings(deps.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Transform settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.invalidFields.clear();
    this.saveButton = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.invalidFields.clear();
    this.saveButton = null;

    const settings = this.deps.getSettings();
    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Tune context limits, generation, and diagnostics. Preset overrides are changed in the preset manager.',
    });

    this.renderLimits(settings);
    this.renderGeneration(settings);
    this.renderDiagnostics(settings);
    this.renderActions();
  }

  private renderLimits(settings: PluginSettings): void {
    const items = createSettingGroup(this.contentEl, 'Limits');
    const mode =
      settings.llmPostprocessMode === 'off'
        ? settings.llmPostprocessLastEnabledMode
        : settings.llmPostprocessMode;

    if (mode !== 'batch') {
      this.addNumberSetting(items, {
        desc: 'Maximum combined characters from note context and prior phrases. Large contexts can slow local models and reduce quality.',
        integer: true,
        key: 'llmPostprocessTotalContextCap',
        max: LLM_TOTAL_CONTEXT_CAP_MAX,
        min: 0,
        name: 'Total context cap',
      });
      this.addNumberSetting(items, {
        desc: 'Number of recent transcribed phrases included as conversation history.',
        integer: true,
        key: 'llmPostprocessPriorUtterancesN',
        max: LLM_PRIOR_UTTERANCES_MAX,
        min: 0,
        name: 'Prior phrases',
      });
    }

    if (settings.llmRemoteFeaturesEnabled && settings.llmRouting !== 'local') {
      this.addNumberSetting(items, {
        desc: 'Abort an OpenRouter transform after this many seconds. The raw transcript is kept.',
        integer: true,
        key: 'llmRemoteTimeoutSec',
        max: MAX_LLM_REMOTE_TIMEOUT_SEC,
        min: MIN_LLM_REMOTE_TIMEOUT_SEC,
        name: 'Remote timeout (seconds)',
      });
    }

    const override = activePresetOverride(settings, 'minWords');
    this.addNumberSetting(items, {
      desc:
        override !== null
          ? `Set by preset "${override.label}". Edit the preset to change it.`
          : 'Skip the LLM transform when the phrase has fewer words than this.',
      disabled: override !== null,
      displayValue:
        typeof override?.value === 'number'
          ? override.value
          : this.draft.llmPostprocessSkipMinWords,
      integer: true,
      key: 'llmPostprocessSkipMinWords',
      max: LLM_MIN_WORDS_MAX,
      min: 0,
      name: 'Minimum words',
    });
  }

  private renderGeneration(settings: PluginSettings): void {
    const items = createSettingGroup(this.contentEl, 'Generation');
    const override = activePresetOverride(settings, 'temperature');
    this.addNumberSetting(items, {
      desc:
        override !== null
          ? `Set by preset "${override.label}". Edit the preset to change it.`
          : 'Sampling randomness. 0 is deterministic; higher values are more varied.',
      disabled: override !== null,
      displayValue:
        typeof override?.value === 'number' ? override.value : this.draft.llmPostprocessTemperature,
      key: 'llmPostprocessTemperature',
      max: LLM_TEMPERATURE_MAX,
      min: 0,
      name: 'Temperature',
      step: 0.1,
    });
  }

  private renderDiagnostics(settings: PluginSettings): void {
    const items = createSettingGroup(this.contentEl, 'Diagnostics');

    if (settings.timestampsEnabled) {
      items.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'After each phrase preserves timestamps. All at once may rewrite or remove them depending on the prompt.',
      });
    }

    new Setting(items)
      .setName('Show raw beneath LLM output')
      .setDesc('Keep the raw transcript in a collapsible callout beneath each transformed result.')
      .addToggle((toggle) => {
        toggle.setValue(this.draft.llmPostprocessShowRawBelow);
        toggle.onChange((value) => {
          this.draft = { ...this.draft, llmPostprocessShowRawBelow: value };
        });
      });

    new Setting(items)
      .setName('Reset LLM defaults')
      .setDesc(
        'Restore the default preset, timing, context, skip gates, and generation values. Saved presets and provider models are kept.',
      )
      .addButton((button) => {
        button
          .setButtonText('Reset')
          .setWarning()
          .onClick(() => {
            this.confirmResetDefaults();
          });
      });
  }

  private renderActions(): void {
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.saveButton = button;
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            void this.handleSave();
          });
      });
    this.refreshSaveState();
  }

  private addNumberSetting<TKey extends LlmTransformNumberField>(
    parent: HTMLElement,
    options: NumberSettingOptions<TKey>,
  ): void {
    new Setting(parent)
      .setName(options.name)
      .setDesc(options.desc)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = String(options.min);
        text.inputEl.max = String(options.max);
        text.inputEl.step = String(options.step ?? 1);
        text.setValue(String(options.displayValue ?? this.draft[options.key]));
        text.setDisabled(options.disabled === true);
        text.onChange((value) => {
          const parsed = Number(value);
          const valid =
            value.trim().length > 0 &&
            Number.isFinite(parsed) &&
            parsed >= options.min &&
            parsed <= options.max &&
            (options.integer !== true || Number.isInteger(parsed));
          text.inputEl.setCustomValidity(
            valid
              ? ''
              : options.integer === true
                ? `Enter a whole number from ${options.min} to ${options.max}.`
                : `Enter a number from ${options.min} to ${options.max}.`,
          );
          if (valid) {
            this.invalidFields.delete(options.key);
            this.draft = { ...this.draft, [options.key]: parsed };
          } else {
            this.invalidFields.add(options.key);
          }
          this.refreshSaveState();
        });
      });
  }

  private refreshSaveState(): void {
    this.saveButton?.setDisabled(this.invalidFields.size > 0);
  }

  private async handleSave(): Promise<void> {
    if (this.invalidFields.size > 0) {
      return;
    }
    await this.deps.saveSettings({
      ...this.deps.getSettings(),
      ...this.draft,
    });
    this.deps.onSave?.();
    this.close();
  }

  private confirmResetDefaults(): void {
    new ConfirmModal(this.app, {
      title: 'Reset LLM defaults',
      message:
        'Restore the default preset, timing, context, skip gates, and generation values? Saved presets and provider models are kept.',
      confirmLabel: 'Reset',
      destructive: true,
      onConfirm: async () => {
        await this.deps.resetDefaults();
        this.deps.onSave?.();
        this.close();
      },
    }).open();
  }
}

function draftFromSettings(settings: PluginSettings): LlmTransformSettingsDraft {
  return {
    llmPostprocessPriorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    llmPostprocessShowRawBelow: settings.llmPostprocessShowRawBelow,
    llmPostprocessSkipMinWords: settings.llmPostprocessSkipMinWords,
    llmPostprocessTemperature: settings.llmPostprocessTemperature,
    llmPostprocessTotalContextCap: settings.llmPostprocessTotalContextCap,
    llmRemoteTimeoutSec: settings.llmRemoteTimeoutSec,
  };
}
