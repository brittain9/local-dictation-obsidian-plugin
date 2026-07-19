import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { buildCapabilityLabels } from './capability-view';
import { localizeModelSummary } from './catalog-localization';
import {
  DEFAULT_EXTERNAL_FILE_ENGINE_SELECTION,
  EXTERNAL_FILE_ENGINES,
  formatExternalModelValidationError,
  getExternalFileEngineOption,
} from './external-model-file';
import type { ModelInstallManager } from './model-install-manager';
import {
  type CatalogModelRecord,
  type EngineCapabilitiesRecord,
  type ExternalFileModelSelection,
  getTotalModelSize,
} from './model-management-types';

interface ExternalModelFileModalDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  manager: ModelInstallManager;
  onChanged: () => Promise<void>;
}

export class ExternalModelFileModal extends Modal {
  private engine: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;
  private errorEl: HTMLParagraphElement | null = null;
  private guidanceEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly currentPath: string,
    private readonly dependencies: ExternalModelFileModalDependencies,
  ) {
    super(app);
    this.engine = this.initialEngine();
  }

  override onOpen(): void {
    this.titleEl.setText(t('models.external.title'));
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: t('models.external.intro'),
    });

    new Setting(this.contentEl)
      .setName(t('models.external.family.name'))
      .setDesc(t('models.external.family.desc'))
      .addDropdown((dropdown) => {
        for (const option of EXTERNAL_FILE_ENGINES) {
          dropdown.addOption(engineKey(option.selection), option.label);
        }
        dropdown.setValue(engineKey(this.engine));
        dropdown.onChange((value) => {
          const option = EXTERNAL_FILE_ENGINES.find(
            (candidate) => engineKey(candidate.selection) === value,
          );
          if (option !== undefined) {
            this.engine = option.selection;
            this.renderGuidance();
            this.inputEl?.setAttr('placeholder', option.placeholder);
            this.setValidationError(null);
          }
        });
      });

    this.guidanceEl = this.contentEl.createDiv({ cls: 'local-stt-external-model-guidance' });
    this.renderGuidance();

    new Setting(this.contentEl)
      .setName(t('models.external.path.name'))
      .setDesc(t('models.external.path.desc'))
      .addText((text) => {
        const option = getExternalFileEngineOption(this.engine);
        text.setPlaceholder(option?.placeholder ?? '/absolute/path/to/model');
        text.setValue(this.currentPath);
        this.inputEl = text.inputEl;
        this.inputEl.addEventListener('input', () => {
          this.setValidationError(null);
        });
      });

    this.inputEl?.focus();

    this.errorEl = this.contentEl.createEl('p', {
      attr: { 'aria-live': 'polite' },
      cls: 'local-stt-external-model-error local-stt-hidden',
    });

    let validating = false;
    new Setting(this.contentEl).addButton((button) => {
      button
        .setCta()
        .setButtonText(t('models.external.validateAndUse'))
        .onClick(async () => {
          if (validating) {
            return;
          }

          validating = true;
          button.setDisabled(true).setButtonText(t('models.external.validating'));
          this.setValidationError(null);
          const nextPath = this.inputEl?.value.trim() ?? '';

          try {
            await this.dependencies.manager.validateAndSelectExternalFile(nextPath, this.engine);
            await this.dependencies.onChanged();
            this.dependencies.feedback.show({
              intent: 'success',
              message: t('models.external.selectedNotice'),
            });
            this.close();
          } catch (error) {
            const message = formatExternalModelValidationError(error);
            this.setValidationError(message);
            this.dependencies.feedback.show({
              cause: error,
              intent: 'error',
              message,
            });
          } finally {
            validating = false;
            button.setDisabled(false).setButtonText(t('models.external.validateAndUse'));
          }
        });
    });
  }

  private renderGuidance(): void {
    if (this.guidanceEl === null) {
      return;
    }

    this.guidanceEl.empty();
    const option = getExternalFileEngineOption(this.engine);
    if (option === null) {
      return;
    }

    this.guidanceEl.createEl('strong', { text: t('models.external.requirementsTitle') });
    const requirements = this.guidanceEl.createEl('ul');
    for (const requirement of option.requirements) {
      requirements.createEl('li', { text: requirement });
    }
  }

  private setValidationError(message: string | null): void {
    if (this.errorEl === null) {
      return;
    }

    this.errorEl.setText(message ?? '');
    this.errorEl.toggleClass('local-stt-hidden', message === null);
  }

  private initialEngine(): Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'> {
    const selected = this.dependencies.manager.getState().selectedModel;
    if (selected?.kind === 'external_file') {
      const option = getExternalFileEngineOption(selected);
      if (option !== null) {
        return option.selection;
      }
    }
    return DEFAULT_EXTERNAL_FILE_ENGINE_SELECTION;
  }
}

function engineKey(selection: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>): string {
  return `${selection.runtimeId}:${selection.familyId}`;
}

export class ModelDetailsModal extends Modal {
  constructor(
    app: App,
    private readonly model: CatalogModelRecord,
    private readonly installPath: string | null,
    private readonly capabilities: EngineCapabilitiesRecord | null,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.model.displayName);
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: localizeModelSummary(this.model.modelId, this.model.summary),
    });

    const dl = this.contentEl.createEl('dl', { cls: 'local-stt-details-grid' });

    const totalSize = getTotalModelSize(this.model);
    if (totalSize > 0) {
      dl.createEl('dt', { text: t('models.details.totalSize') });
      dl.createEl('dd', { text: formatBytes(totalSize) });
    }

    dl.createEl('dt', { text: t('models.details.source') });
    appendDetailsLink(dl.createEl('dd'), this.model.sourceUrl, this.model.sourceUrl, true);

    dl.createEl('dt', { text: t('models.details.license') });
    appendDetailsLink(dl.createEl('dd'), this.model.licenseLabel, this.model.licenseUrl);

    if (this.capabilities !== null) {
      dl.createEl('dt', { text: t('models.details.capabilities') });
      dl.createEl('dd', { text: buildCapabilityLabels(this.capabilities).join(', ') });
    }

    if (this.installPath !== null) {
      dl.createEl('dt', { text: t('models.details.installPath') });
      dl.createEl('dd', { text: this.installPath, cls: 'local-stt-mono' });
    }

    if (this.model.artifacts.length > 0) {
      const table = this.contentEl.createEl('table', { cls: 'local-stt-artifact-table' });
      const thead = table.createEl('thead');
      const headerRow = thead.createEl('tr');
      headerRow.createEl('th', {
        text: t('models.details.files', { count: this.model.artifacts.length }),
      });
      headerRow.createEl('th', { text: t('models.details.size') });

      const tbody = table.createEl('tbody');
      for (const artifact of this.model.artifacts) {
        const tr = tbody.createEl('tr');
        tr.createEl('td', { text: artifact.filename, cls: 'local-stt-mono' });
        tr.createEl('td', { text: formatBytes(artifact.sizeBytes) });
      }
    }
  }
}

function appendDetailsLink(
  container: HTMLElement,
  label: string,
  href: string,
  monospace = false,
): void {
  const link = container.createEl('a', {
    href,
    text: label,
  });

  link.setAttr('target', '_blank');
  link.setAttr('rel', 'noopener noreferrer');
  if (monospace) {
    link.addClass('local-stt-mono');
  }
}
