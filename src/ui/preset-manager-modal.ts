import type { App, DropdownComponent } from 'obsidian';
import { Modal, prepareSimpleSearch, renderMatches, SearchComponent, Setting } from 'obsidian';

import {
  formatStyleRef,
  LLM_BUILTIN_PRESETS,
  type LlmPreset,
  type LlmPresetEntry,
  listPresetEntries,
  resolveActivePresetEntry,
} from '../llm/presets';
import type { LlmPresetStateMutation } from '../settings/llm-preset-state';
import {
  LLM_MIN_WORDS_MAX,
  LLM_TEMPERATURE_MAX,
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
  type PluginSettings,
} from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { ConfirmModal } from './confirm-modal';
import {
  applyPresetDraftSave,
  draftFromPreset,
  duplicateLabel,
  emptyPresetDraft,
  type LlmPresetDraft,
  MAX_PRESETS_MESSAGE,
} from './preset-draft';
import { type PresetSearchHit, searchPresetEntries } from './preset-search';

interface PresetManagerModalDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  mutatePresetState: (mutation: LlmPresetStateMutation) => Promise<void>;
}

type EditorState =
  | { kind: 'create'; draft: LlmPresetDraft }
  | { kind: 'edit'; draft: LlmPresetDraft; presetId: string }
  | { kind: 'view'; preset: LlmPreset };

export class PresetManagerModal extends Modal {
  private editor: EditorState | null = null;
  private isOpen = false;
  private searchQuery = '';

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
      this.setTitle(t('llm.preset.manager.title'));
      this.renderList();
      return;
    }
    this.setTitle(
      this.editor.kind === 'create'
        ? t('llm.preset.manager.newTitle')
        : this.editor.kind === 'edit'
          ? t('llm.preset.manager.editTitle')
          : this.editor.preset.label,
    );
    this.renderEditor(this.editor);
  }

  private reachedMaxCount(): boolean {
    return this.deps.getSettings().llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;
  }

  // ------------------------------------------------------------------ list

  private renderList(): void {
    const reachedMaxCount = this.reachedMaxCount();

    new Setting(this.contentEl)
      .setName(t('llm.preset.manager.presets.name'))
      .setDesc(t('llm.preset.manager.presets.description'))
      .addButton((button) => {
        button.setCta().setButtonText(t('llm.preset.manager.new'));
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

    const searchEl = this.contentEl.createDiv('search-input-container local-stt-preset-search');
    const listEl = this.contentEl.createDiv();
    new SearchComponent(searchEl)
      .setPlaceholder(t('llm.preset.manager.searchPlaceholder'))
      .setValue(this.searchQuery)
      .onChange((value) => {
        // Re-render only the list so the search input keeps focus.
        this.searchQuery = value;
        this.renderListEntries(listEl);
      });
    this.renderListEntries(listEl);
  }

  private renderListEntries(listEl: HTMLElement): void {
    listEl.empty();
    const settings = this.deps.getSettings();
    const activeRef = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    ).ref;
    const query = this.searchQuery.trim();
    const hits = searchPresetEntries(
      listPresetEntries(settings.llmPostprocessUserPresets),
      query === '' ? null : prepareSimpleSearch(query),
    );
    if (hits.length === 0) {
      listEl.createEl('p', {
        cls: 'local-stt-preset-empty',
        text: t('llm.preset.manager.noMatches'),
      });
      return;
    }
    const builtinHits = hits.filter((hit) => hit.entry.isBuiltin);
    if (builtinHits.length > 0) {
      this.renderListSection(
        listEl,
        t('llm.preset.manager.builtinHeading'),
        builtinHits,
        activeRef,
      );
    }
    const userHits = hits.filter((hit) => !hit.entry.isBuiltin);
    if (userHits.length > 0) {
      this.renderListSection(listEl, t('llm.preset.manager.yoursHeading'), userHits, activeRef);
    }
  }

  private renderListSection(
    listEl: HTMLElement,
    heading: string,
    hits: PresetSearchHit[],
    activeRef: string,
  ): void {
    const reachedMaxCount = this.reachedMaxCount();
    new Setting(listEl).setName(heading).setHeading();
    for (const hit of hits) {
      const { entry } = hit;
      const { preset } = entry;
      const name = createFragment();
      renderMatches(name, preset.label, hit.labelMatches);
      if (entry.ref === activeRef) {
        name.append(' ✓');
      }
      const description = createFragment();
      renderMatches(description, hit.description, hit.descriptionMatches);
      const setting = new Setting(listEl).setName(name).setDesc(description);
      setting.setClass('local-stt-preset-row');
      const openLabel = entry.isBuiltin
        ? t('llm.preset.manager.viewTooltip')
        : t('llm.preset.manager.editTooltip');
      setting.infoEl.tabIndex = 0;
      setting.infoEl.setAttribute('role', 'button');
      setting.infoEl.setAttribute('aria-label', `${openLabel}: ${preset.label}`);
      setting.infoEl.addEventListener('click', () => {
        this.openEntry(entry);
      });
      setting.infoEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        this.openEntry(entry);
      });

      setting.addExtraButton((button) => {
        button
          .setIcon(entry.isBuiltin ? 'eye' : 'pencil')
          .setTooltip(openLabel)
          .onClick(() => {
            this.openEntry(entry);
          });
      });
      setting.addExtraButton((button) => {
        button.setIcon('copy').setTooltip(t('llm.preset.manager.duplicateTooltip'));
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
            .setTooltip(t('llm.preset.manager.deleteTooltip', { preset: preset.label }))
            .onClick(() => {
              this.confirmDelete(preset);
            });
        });
      }
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
    draft.label = duplicateLabel(preset.label, [
      ...LLM_BUILTIN_PRESETS.map((entry) => entry.label),
      ...this.deps.getSettings().llmPostprocessUserPresets.map((entry) => entry.label),
    ]);
    this.editor = { kind: 'create', draft };
    this.render();
  }

  // ---------------------------------------------------------------- editor

  private renderEditor(editor: EditorState): void {
    const isBuiltinView = editor.kind === 'view';
    const draft = editor.kind === 'view' ? draftFromPreset(editor.preset) : editor.draft;

    const backButton = this.contentEl.createEl('button', {
      cls: 'local-stt-preset-back',
      text: t('llm.preset.manager.back'),
    });
    backButton.addEventListener('click', () => {
      this.editor = null;
      this.render();
    });

    new Setting(this.contentEl).setName(t('llm.preset.editor.name')).addText((text) => {
      text.setPlaceholder(t('llm.preset.editor.namePlaceholder'));
      text.setValue(draft.label);
      text.setDisabled(isBuiltinView);
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      text.onChange((value) => {
        draft.label = value;
      });
    });

    new Setting(this.contentEl).setName(t('llm.preset.editor.description')).addTextArea((text) => {
      text.setPlaceholder(t('llm.preset.editor.descriptionPlaceholder'));
      text.setValue(draft.description);
      text.setDisabled(isBuiltinView);
      text.inputEl.rows = 2;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      text.onChange((value) => {
        draft.description = value;
      });
    });

    const promptSetting = new Setting(this.contentEl)
      .setName(t('llm.preset.editor.prompt'))
      .setDesc(t('llm.preset.editor.promptDescription'));
    promptSetting.setClass('local-stt-preset-editor__prompt');
    const updatePromptSize = (value: string) => {
      promptSizeEl.setText(
        t('llm.preset.editor.promptSize', {
          characters: value.length,
          tokens: Math.ceil(value.length / 4),
        }),
      );
    };
    promptSetting.addTextArea((text) => {
      text.setValue(draft.prompt);
      text.setDisabled(isBuiltinView);
      text.inputEl.rows = 8;
      text.onChange((value) => {
        draft.prompt = value;
        updatePromptSize(value);
      });
    });
    const promptSizeEl = this.contentEl.createEl('p', {
      cls: 'local-stt-preset-editor__prompt-size',
    });
    updatePromptSize(draft.prompt);

    let timingDropdown: DropdownComponent | null = null;
    new Setting(this.contentEl)
      .setName(t('llm.preset.editor.timing'))
      .setDesc(t('llm.preset.editor.timingDescription'))
      .addDropdown((dropdown) => {
        dropdown.addOption('either', t('llm.preset.editor.timingEither'));
        dropdown.addOption('per_utterance', t('llm.preset.editor.timingPerUtterance'));
        dropdown.addOption('batch', t('llm.preset.editor.timingBatch'));
        dropdown.setValue(draft.timing);
        dropdown.setDisabled(isBuiltinView || draft.output !== 'replace');
        dropdown.onChange((value) => {
          draft.timing = value === 'per_utterance' || value === 'batch' ? value : 'either';
        });
        timingDropdown = dropdown;
      });

    new Setting(this.contentEl)
      .setName(t('llm.preset.editor.output'))
      .setDesc(t('llm.preset.editor.outputDescription'))
      .addDropdown((dropdown) => {
        dropdown.addOption('replace', t('llm.preset.editor.outputReplace'));
        dropdown.addOption('add_above', t('llm.preset.editor.outputAddAbove'));
        dropdown.addOption('add_below', t('llm.preset.editor.outputAddBelow'));
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
      .setName(t('llm.preset.editor.overrides'))
      .setHeading()
      .setDesc(t('llm.preset.editor.overridesDescription'));

    new Setting(this.contentEl).setName(t('llm.preset.editor.minimumWords')).addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = String(LLM_MIN_WORDS_MAX);
      text.setPlaceholder(t('common.inherit'));
      text.setValue(draft.minWords);
      text.setDisabled(isBuiltinView);
      text.onChange((value) => {
        draft.minWords = value;
      });
    });

    new Setting(this.contentEl).setName(t('llm.model.temperature.name')).addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = String(LLM_TEMPERATURE_MAX);
      text.inputEl.step = '0.05';
      text.setPlaceholder(t('common.inherit'));
      text.setValue(draft.temperature);
      text.setDisabled(isBuiltinView);
      text.onChange((value) => {
        draft.temperature = value;
      });
    });

    new Setting(this.contentEl)
      .setName(t('llm.context.useCurrentNote.name'))
      .addDropdown((dropdown) => {
        dropdown.addOption('inherit', t('common.inherit'));
        dropdown.addOption('on', t('common.on'));
        dropdown.addOption('off', t('common.off'));
        dropdown.setValue(draft.useNoteContext);
        dropdown.setDisabled(isBuiltinView);
        dropdown.onChange((value) => {
          draft.useNoteContext = value === 'on' || value === 'off' ? value : 'inherit';
        });
      });

    const errorEl = this.contentEl.createEl('p', {
      cls: 'local-stt-preset-editor__error',
    });
    errorEl.setAttribute('role', 'alert');
    errorEl.setAttribute('aria-live', 'polite');
    errorEl.hide();

    const buttons = new Setting(this.contentEl);
    if (editor.kind === 'view') {
      buttons.addButton((button) => {
        button.setCta().setButtonText(t('common.duplicate'));
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
        button.setButtonText(t('common.cancel')).onClick(() => {
          this.editor = null;
          this.render();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(t('common.save'))
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
    const editedId = editor.kind === 'edit' ? editor.presetId : null;
    let validationError: string | null = null;
    await this.deps.mutatePresetState((state) => {
      const outcome = applyPresetDraftSave(state, editor.draft, editedId);
      validationError = outcome.error;
      return outcome.state;
    });
    if (validationError !== null) {
      errorEl.setText(validationError);
      errorEl.show();
      return;
    }

    this.editor = null;
    this.render();
  }

  private confirmDelete(preset: LlmPreset): void {
    new ConfirmModal(this.app, {
      title: t('llm.preset.delete.title'),
      message: t('llm.preset.delete.message', { preset: preset.label }),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: async () => {
        const ref = formatStyleRef({ kind: 'user', id: preset.id });
        let wasActive = false;
        await this.deps.mutatePresetState((state) => {
          wasActive = state.activePresetRef === ref;
          return {
            activePresetRef: wasActive
              ? resolveActivePresetEntry(null, []).ref
              : state.activePresetRef,
            userPresets: state.userPresets.filter((entry) => entry.id !== preset.id),
          };
        });
        if (wasActive) {
          this.deps.feedback.show({
            intent: 'information',
            message: t('llm.preset.delete.activeFallback', { preset: preset.label }),
          });
        }
        this.render();
      },
    }).open();
  }
}
