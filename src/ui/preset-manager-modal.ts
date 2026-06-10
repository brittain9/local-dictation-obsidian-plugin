import { randomUUID } from 'node:crypto';

import type { App, DropdownComponent } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import {
  describePresetBehavior,
  formatStyleRef,
  LLM_BUILTIN_PRESETS,
  type LlmPreset,
  type LlmPresetEntry,
  listPresetEntries,
  resolveActivePresetEntry,
} from '../llm/presets';
import {
  LLM_MIN_WORDS_MAX,
  LLM_TEMPERATURE_MAX,
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
  type PluginSettings,
} from '../settings/plugin-settings';
import { ConfirmModal } from './confirm-modal';
import {
  draftFromPreset,
  duplicateLabel,
  emptyPresetDraft,
  type LlmPresetDraft,
  validatePresetDraft,
} from './preset-draft';

interface PresetManagerModalDependencies {
  getSettings: () => PluginSettings;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

type EditorState =
  | { kind: 'create'; draft: LlmPresetDraft }
  | { kind: 'edit'; draft: LlmPresetDraft; presetId: string }
  | { kind: 'view'; preset: LlmPreset };

const MAX_PRESETS_MESSAGE = `You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one first.`;

export class PresetManagerModal extends Modal {
  private editor: EditorState | null = null;
  private isOpen = false;

  constructor(
    app: App,
    private readonly deps: PresetManagerModalDependencies,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.isOpen = true;
    this.modalEl.addClass('local-stt-preset-manager');
    this.render();
  }

  override onClose(): void {
    this.isOpen = false;
    this.contentEl.empty();
    this.editor = null;
  }

  private render(): void {
    // Saves and deletes re-render after an await; skip if the modal was
    // dismissed in the meantime.
    if (!this.isOpen) {
      return;
    }
    this.contentEl.empty();
    if (this.editor === null) {
      this.titleEl.setText('Manage presets');
      this.renderList();
      return;
    }
    this.titleEl.setText(
      this.editor.kind === 'create'
        ? 'New preset'
        : this.editor.kind === 'edit'
          ? 'Edit preset'
          : this.editor.preset.label,
    );
    this.renderEditor(this.editor);
  }

  private reachedMaxCount(): boolean {
    return this.deps.getSettings().llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;
  }

  // ------------------------------------------------------------------ list

  private renderList(): void {
    const settings = this.deps.getSettings();
    const activeRef = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    ).ref;
    const reachedMaxCount = this.reachedMaxCount();

    new Setting(this.contentEl)
      .setName('Presets')
      .setDesc(
        'The active preset is marked. Built-in presets are read-only — duplicate one to customize it.',
      )
      .addButton((button) => {
        button.setCta().setButtonText('New preset');
        if (reachedMaxCount) {
          button.setDisabled(true);
          button.setTooltip(MAX_PRESETS_MESSAGE);
          return;
        }
        button.onClick(() => {
          this.editor = { kind: 'create', draft: emptyPresetDraft() };
          this.render();
        });
      });

    const entries = listPresetEntries(settings.llmPostprocessUserPresets);
    this.renderListSection(
      'Built-in',
      entries.filter((entry) => entry.isBuiltin),
      activeRef,
    );
    const userEntries = entries.filter((entry) => !entry.isBuiltin);
    if (userEntries.length > 0) {
      this.renderListSection('Your presets', userEntries, activeRef);
    }
  }

  private renderListSection(heading: string, entries: LlmPresetEntry[], activeRef: string): void {
    const reachedMaxCount = this.reachedMaxCount();
    new Setting(this.contentEl).setName(heading).setHeading();
    for (const entry of entries) {
      const { preset } = entry;
      const setting = new Setting(this.contentEl)
        .setName(entry.ref === activeRef ? `${preset.label} ✓` : preset.label)
        .setDesc(preset.description ?? describePresetBehavior(preset));
      setting.settingEl.addClass('local-stt-preset-row');

      setting.addExtraButton((button) => {
        button
          .setIcon(entry.isBuiltin ? 'eye' : 'pencil')
          .setTooltip(entry.isBuiltin ? 'View preset' : 'Edit preset')
          .onClick(() => {
            this.openEntry(entry);
          });
      });
      setting.addExtraButton((button) => {
        button.setIcon('copy').setTooltip('Duplicate preset');
        if (reachedMaxCount) {
          button.setDisabled(true);
          return;
        }
        button.onClick(() => {
          this.openDuplicate(preset);
        });
      });
      if (!entry.isBuiltin) {
        setting.addExtraButton((button) => {
          button
            .setIcon('trash-2')
            .setTooltip(`Delete preset "${preset.label}"`)
            .onClick(() => {
              this.confirmDelete(preset);
            });
        });
      }

      setting.settingEl.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button') !== null) {
          return;
        }
        this.openEntry(entry);
      });
    }
  }

  private openEntry(entry: LlmPresetEntry): void {
    this.editor = entry.isBuiltin
      ? { kind: 'view', preset: entry.preset }
      : { kind: 'edit', draft: draftFromPreset(entry.preset), presetId: entry.preset.id };
    this.render();
  }

  private openDuplicate(preset: LlmPreset): void {
    const draft = draftFromPreset(preset);
    draft.label = duplicateLabel(preset.label);
    this.editor = { kind: 'create', draft };
    this.render();
  }

  // ---------------------------------------------------------------- editor

  private renderEditor(editor: EditorState): void {
    const isBuiltinView = editor.kind === 'view';
    const draft = editor.kind === 'view' ? draftFromPreset(editor.preset) : editor.draft;

    const backButton = this.contentEl.createEl('button', {
      cls: 'local-stt-preset-back',
      text: '← All presets',
    });
    backButton.addEventListener('click', () => {
      this.editor = null;
      this.render();
    });

    new Setting(this.contentEl).setName('Name').addText((text) => {
      text.setPlaceholder('e.g. Meeting notes');
      text.setValue(draft.label);
      text.setDisabled(isBuiltinView);
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      text.onChange((value) => {
        draft.label = value;
      });
    });

    new Setting(this.contentEl).setName('Description (optional)').addTextArea((text) => {
      text.setPlaceholder('When to use this preset');
      text.setValue(draft.description);
      text.setDisabled(isBuiltinView);
      text.inputEl.rows = 2;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      text.onChange((value) => {
        draft.description = value;
      });
    });

    const promptSetting = new Setting(this.contentEl)
      .setName('Prompt')
      .setDesc('Sent to the model as the system prompt.');
    promptSetting.settingEl.addClass('local-stt-preset-editor__prompt');
    promptSetting.addTextArea((text) => {
      text.setValue(draft.prompt);
      text.setDisabled(isBuiltinView);
      text.inputEl.rows = 8;
      text.onChange((value) => {
        draft.prompt = value;
      });
    });

    let timingDropdown: DropdownComponent | null = null;
    new Setting(this.contentEl)
      .setName('Timing')
      .setDesc('When the transform runs. "Either" follows the panel Mode setting.')
      .addDropdown((dropdown) => {
        dropdown.addOption('either', 'Either (follow Mode)');
        dropdown.addOption('per_utterance', 'After each phrase');
        dropdown.addOption('batch', 'Once on stop');
        dropdown.setValue(draft.timing);
        dropdown.setDisabled(isBuiltinView || draft.output !== 'replace');
        dropdown.onChange((value) => {
          draft.timing = value === 'per_utterance' || value === 'batch' ? value : 'either';
        });
        timingDropdown = dropdown;
      });

    new Setting(this.contentEl)
      .setName('Output')
      .setDesc(
        'Replace rewrites your dictated text. Add keeps it untouched and inserts new content.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('replace', 'Replace text');
        dropdown.addOption('add_above', 'Add above transcript');
        dropdown.addOption('add_below', 'Add below transcript');
        dropdown.setValue(draft.output);
        dropdown.setDisabled(isBuiltinView);
        dropdown.onChange((value) => {
          draft.output = value === 'add_above' || value === 'add_below' ? value : 'replace';
          // Additive output only runs once on stop; pin and lock the timing.
          if (draft.output !== 'replace') {
            draft.timing = 'batch';
          }
          timingDropdown?.setValue(draft.output === 'replace' ? draft.timing : 'batch');
          timingDropdown?.setDisabled(draft.output !== 'replace');
        });
      });

    new Setting(this.contentEl)
      .setName('Overrides')
      .setHeading()
      .setDesc('Leave a field blank to use the global setting.');

    new Setting(this.contentEl).setName('Min words').addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = String(LLM_MIN_WORDS_MAX);
      text.setPlaceholder('Inherit');
      text.setValue(draft.minWords);
      text.setDisabled(isBuiltinView);
      text.onChange((value) => {
        draft.minWords = value;
      });
    });

    new Setting(this.contentEl).setName('Temperature').addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = String(LLM_TEMPERATURE_MAX);
      text.inputEl.step = '0.05';
      text.setPlaceholder('Inherit');
      text.setValue(draft.temperature);
      text.setDisabled(isBuiltinView);
      text.onChange((value) => {
        draft.temperature = value;
      });
    });

    new Setting(this.contentEl).setName('Use note as LLM context').addDropdown((dropdown) => {
      dropdown.addOption('inherit', 'Inherit');
      dropdown.addOption('on', 'On');
      dropdown.addOption('off', 'Off');
      dropdown.setValue(draft.useNoteContext);
      dropdown.setDisabled(isBuiltinView);
      dropdown.onChange((value) => {
        draft.useNoteContext = value === 'on' || value === 'off' ? value : 'inherit';
      });
    });

    const errorEl = this.contentEl.createEl('p', {
      cls: 'local-stt-preset-editor__error local-stt-hidden',
    });
    errorEl.setAttribute('role', 'alert');
    errorEl.setAttribute('aria-live', 'polite');

    const buttons = new Setting(this.contentEl);
    if (editor.kind === 'view') {
      buttons.addButton((button) => {
        button.setCta().setButtonText('Duplicate');
        if (this.reachedMaxCount()) {
          button.setDisabled(true);
          button.setTooltip(MAX_PRESETS_MESSAGE);
          return;
        }
        button.onClick(() => {
          this.openDuplicate(editor.preset);
        });
      });
      return;
    }

    buttons
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.editor = null;
          this.render();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            void this.handleSave(editor, errorEl);
          });
      });
  }

  // ------------------------------------------------------------ persistence

  private async handleSave(
    editor:
      | { kind: 'create'; draft: LlmPresetDraft }
      | { kind: 'edit'; draft: LlmPresetDraft; presetId: string },
    errorEl: HTMLElement,
  ): Promise<void> {
    const settings = this.deps.getSettings();
    const editedId = editor.kind === 'edit' ? editor.presetId : null;

    const label = editor.draft.label.trim().toLowerCase();
    if (LLM_BUILTIN_PRESETS.some((preset) => preset.label.toLowerCase() === label)) {
      errorEl.setText('That name is used by a built-in preset — choose a different name.');
      errorEl.removeClass('local-stt-hidden');
      return;
    }

    const existingLabels = settings.llmPostprocessUserPresets
      .filter((preset) => preset.id !== editedId)
      .map((preset) => preset.label);

    const result = validatePresetDraft(editor.draft, existingLabels);
    if (result.kind === 'error') {
      errorEl.setText(result.message);
      errorEl.removeClass('local-stt-hidden');
      return;
    }

    if (editedId !== null) {
      await this.deps.saveSettings({
        ...settings,
        llmPostprocessUserPresets: settings.llmPostprocessUserPresets.map((preset) =>
          preset.id === editedId ? { ...result.preset, id: editedId } : preset,
        ),
      });
    } else {
      if (settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
        errorEl.setText(MAX_PRESETS_MESSAGE);
        errorEl.removeClass('local-stt-hidden');
        return;
      }
      await this.deps.saveSettings({
        ...settings,
        llmPostprocessUserPresets: [
          ...settings.llmPostprocessUserPresets,
          { ...result.preset, id: randomUUID() },
        ],
      });
    }
    this.editor = null;
    this.render();
  }

  private confirmDelete(preset: LlmPreset): void {
    new ConfirmModal(this.app, {
      title: 'Delete preset',
      message: `Delete preset "${preset.label}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const settings = this.deps.getSettings();
        const ref = formatStyleRef({ kind: 'user', id: preset.id });
        const wasActive = settings.llmPostprocessActivePresetRef === ref;
        await this.deps.saveSettings({
          ...settings,
          llmPostprocessActivePresetRef: wasActive
            ? resolveActivePresetEntry(null, []).ref
            : settings.llmPostprocessActivePresetRef,
          llmPostprocessUserPresets: settings.llmPostprocessUserPresets.filter(
            (entry) => entry.id !== preset.id,
          ),
        });
        if (wasActive) {
          new Notice(`"${preset.label}" was active — switched to Clean up.`);
        }
        this.render();
      },
    }).open();
  }
}
