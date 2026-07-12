import { randomUUID } from 'node:crypto';

import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  MAX_PERSONAL_CORRECTION_RULES,
  mergePersonalCorrectionDraft,
  type PersonalCorrectionRule,
  previewPersonalCorrectionDraft,
  validatePersonalCorrectionRule,
} from '../corrections/correction-rules';
import { ConfirmModal } from './confirm-modal';

interface CorrectionRulesModalDependencies {
  getRules: () => readonly PersonalCorrectionRule[];
  saveRules: (rules: PersonalCorrectionRule[]) => Promise<void>;
}

interface RuleEditor {
  draft: PersonalCorrectionRule;
  isNew: boolean;
  previewText: string;
  previewTouched: boolean;
}

export class CorrectionRulesModal extends Modal {
  private editor: RuleEditor | null = null;
  private isOpen = false;

  constructor(
    app: App,
    private readonly dependencies: CorrectionRulesModalDependencies,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.isOpen = true;
    this.modalEl.addClass('local-stt-correction-rules');
    this.render();
  }

  override onClose(): void {
    this.isOpen = false;
    this.editor = null;
    this.contentEl.empty();
  }

  private render(): void {
    if (!this.isOpen) return;
    this.contentEl.empty();

    if (this.editor === null) {
      this.titleEl.setText('Personal corrections');
      this.renderList();
      return;
    }

    this.titleEl.setText(this.editor.isNew ? 'New correction' : 'Edit correction');
    this.renderEditor(this.editor);
  }

  private renderList(): void {
    const rules = this.dependencies.getRules();
    const atLimit = rules.length >= MAX_PERSONAL_CORRECTION_RULES;
    new Setting(this.contentEl)
      .setName(`${rules.length} correction${rules.length === 1 ? '' : 's'}`)
      .setDesc('Applied from top to bottom after local transcription and before optional cleanup.')
      .addButton((button) => {
        button.setCta().setButtonText('New correction');
        if (atLimit) {
          button
            .setDisabled(true)
            .setTooltip(`Maximum ${MAX_PERSONAL_CORRECTION_RULES} corrections`);
          return;
        }
        button.onClick(() => {
          this.editor = {
            draft: {
              caseSensitive: false,
              enabled: true,
              id: randomUUID(),
              replacement: '',
              source: '',
              wholeWord: true,
            },
            isNew: true,
            previewText: '',
            previewTouched: false,
          };
          this.render();
        });
      });

    if (rules.length === 0) {
      this.contentEl.createEl('p', {
        cls: 'local-stt-correction-rules__empty',
        text: 'No personal corrections yet.',
      });
      return;
    }

    rules.forEach((rule, index) => {
      this.renderRuleRow(rule, index, rules.length);
    });
  }

  private renderRuleRow(rule: PersonalCorrectionRule, index: number, count: number): void {
    const replacement = rule.replacement.length === 0 ? '(remove)' : quote(rule.replacement);
    const description = [
      rule.caseSensitive ? 'Match case' : 'Ignore case',
      rule.wholeWord ? 'Whole words' : 'Anywhere',
    ].join(' | ');
    const setting = new Setting(this.contentEl)
      .setName(`${quote(rule.source)} -> ${replacement}`)
      .setDesc(description);
    setting.settingEl.addClass('local-stt-correction-rules__row');

    setting.addToggle((toggle) => {
      toggle.setTooltip(rule.enabled ? 'Disable correction' : 'Enable correction');
      toggle.setValue(rule.enabled).onChange((enabled) => {
        void this.updateRules((rules) =>
          rules.map((candidate) =>
            candidate.id === rule.id ? { ...candidate, enabled } : candidate,
          ),
        );
      });
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('arrow-up')
        .setTooltip('Move up')
        .setDisabled(index === 0);
      button.onClick(() => {
        void this.moveRule(index, -1);
      });
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('arrow-down')
        .setTooltip('Move down')
        .setDisabled(index === count - 1);
      button.onClick(() => {
        void this.moveRule(index, 1);
      });
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('pencil')
        .setTooltip('Edit correction')
        .onClick(() => {
          this.editor = {
            draft: { ...rule },
            isNew: false,
            previewText: rule.source,
            previewTouched: false,
          };
          this.render();
        });
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('trash-2')
        .setTooltip('Delete correction')
        .onClick(() => {
          this.confirmDelete(rule);
        });
    });
  }

  private renderEditor(editor: RuleEditor): void {
    const backButton = this.contentEl.createEl('button', {
      cls: 'local-stt-correction-rules__back',
      text: 'Back to corrections',
    });
    backButton.addEventListener('click', () => {
      this.editor = null;
      this.render();
    });

    const previewBefore = this.contentEl.createEl('code');
    const previewAfter = this.contentEl.createEl('code');
    const renderPreview = (): void => {
      previewBefore.setText(editor.previewText);
      previewAfter.setText(
        previewPersonalCorrectionDraft(
          editor.previewText,
          this.dependencies.getRules(),
          editor.draft,
          editor.isNew,
        ).text,
      );
    };

    new Setting(this.contentEl).setName('Text to replace').addText((text) => {
      text.setPlaceholder('kuber netes').setValue(editor.draft.source);
      text.onChange((value) => {
        editor.draft.source = value;
        if (!editor.previewTouched) editor.previewText = value;
        renderPreview();
      });
    });
    new Setting(this.contentEl).setName('Replace with').addText((text) => {
      text.setPlaceholder('Kubernetes').setValue(editor.draft.replacement);
      text.onChange((value) => {
        editor.draft.replacement = value;
        renderPreview();
      });
    });
    new Setting(this.contentEl)
      .setName('Whole words')
      .setDesc('Do not change matching text inside a longer word.')
      .addToggle((toggle) => {
        toggle.setValue(editor.draft.wholeWord).onChange((value) => {
          editor.draft.wholeWord = value;
          renderPreview();
        });
      });
    new Setting(this.contentEl).setName('Match case').addToggle((toggle) => {
      toggle.setValue(editor.draft.caseSensitive).onChange((value) => {
        editor.draft.caseSensitive = value;
        renderPreview();
      });
    });
    new Setting(this.contentEl)
      .setName('Try it on')
      .setDesc('Preview the final text after all enabled corrections run in list order.')
      .addText((text) => {
        text.setPlaceholder('Type sample text').setValue(editor.previewText);
        text.onChange((value) => {
          editor.previewText = value;
          editor.previewTouched = true;
          renderPreview();
        });
      });

    const preview = this.contentEl.createDiv({ cls: 'local-stt-correction-rules__preview' });
    preview.createDiv({ cls: 'local-stt-correction-rules__preview-label', text: 'Before' });
    preview.appendChild(previewBefore);
    preview.createDiv({ cls: 'local-stt-correction-rules__preview-label', text: 'After' });
    preview.appendChild(previewAfter);
    renderPreview();

    const errorEl = this.contentEl.createEl('p', {
      cls: 'local-stt-correction-rules__error local-stt-hidden',
    });
    errorEl.setAttribute('aria-live', 'polite');
    errorEl.setAttribute('role', 'alert');

    new Setting(this.contentEl)
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
            void this.saveEditor(editor, errorEl);
          });
      });
  }

  private async saveEditor(editor: RuleEditor, errorEl: HTMLElement): Promise<void> {
    const current = [...this.dependencies.getRules()];
    const validationError = validatePersonalCorrectionRule(editor.draft, current);
    if (validationError !== null) {
      errorEl.setText(validationError);
      errorEl.removeClass('local-stt-hidden');
      return;
    }
    if (editor.isNew && current.length >= MAX_PERSONAL_CORRECTION_RULES) {
      errorEl.setText(`You can save up to ${MAX_PERSONAL_CORRECTION_RULES} corrections.`);
      errorEl.removeClass('local-stt-hidden');
      return;
    }

    const next = mergePersonalCorrectionDraft(current, editor.draft, editor.isNew);
    await this.dependencies.saveRules(next);
    this.editor = null;
    this.render();
  }

  private async moveRule(index: number, delta: -1 | 1): Promise<void> {
    const rules = [...this.dependencies.getRules()];
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const current = rules[index];
    const adjacent = rules[target];
    if (current === undefined || adjacent === undefined) return;
    rules[index] = adjacent;
    rules[target] = current;
    await this.dependencies.saveRules(rules);
    this.render();
  }

  private async updateRules(
    update: (rules: PersonalCorrectionRule[]) => PersonalCorrectionRule[],
  ): Promise<void> {
    await this.dependencies.saveRules(update([...this.dependencies.getRules()]));
    this.render();
  }

  private confirmDelete(rule: PersonalCorrectionRule): void {
    new ConfirmModal(this.app, {
      confirmLabel: 'Delete',
      destructive: true,
      message: `Delete the correction for ${quote(rule.source)}? This cannot be undone.`,
      onConfirm: async () => {
        await this.updateRules((rules) => rules.filter((candidate) => candidate.id !== rule.id));
      },
      title: 'Delete correction',
    }).open();
  }
}

function quote(value: string): string {
  return `"${value}"`;
}
