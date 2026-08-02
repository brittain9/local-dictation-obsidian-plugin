import type { App, TextComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { resolveEngineCapabilities } from './capability-view';
import {
  DEFAULT_EXTERNAL_FILE_ENGINE_SELECTION,
  EXTERNAL_FILE_ENGINES,
  formatExternalModelValidationError,
  getExternalFileEngineOption,
} from './external-model-file';
import {
  buildModelDetailsPresentation,
  type ModelDetailsPresentation,
} from './model-details-presentation';
import type { ModelInstallManager, ModelManagerState } from './model-install-manager';
import {
  type CatalogModelRecord,
  type CatalogModelSelection,
  type EngineCapabilitiesRecord,
  type ExternalFileModelSelection,
  type InstalledModelRecord,
  matchesModelTriple,
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
  private input: TextComponent | null = null;

  constructor(
    app: App,
    private readonly currentPath: string,
    private readonly dependencies: ExternalModelFileModalDependencies,
  ) {
    super(app);
    this.engine = this.initialEngine();
  }

  override onOpen(): void {
    this.setTitle(t('models.external.title'));
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
            this.input?.setPlaceholder(option.placeholder);
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
        this.input = text;
        text.onChange(() => {
          this.setValidationError(null);
        });
      });

    this.input?.inputEl.focus();

    this.errorEl = this.contentEl.createEl('p', {
      attr: { 'aria-live': 'polite' },
      cls: 'local-stt-external-model-error',
    });
    this.errorEl.hide();

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
          const nextPath = this.input?.getValue().trim() ?? '';

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
    this.errorEl.toggle(message !== null);
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
  private readonly presentation: ModelDetailsPresentation;

  constructor(
    app: App,
    model: CatalogModelRecord,
    installedModel: InstalledModelRecord | null,
    capabilities: EngineCapabilitiesRecord | null,
  ) {
    super(app);
    this.presentation = buildModelDetailsPresentation(model, installedModel, capabilities);
  }

  override onOpen(): void {
    const presentation = this.presentation;
    this.setTitle(presentation.displayName);
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: presentation.summary,
    });

    const dl = this.contentEl.createEl('dl', { cls: 'local-stt-details-grid' });

    if (presentation.totalSizeBytes > 0) {
      dl.createEl('dt', { text: t('models.details.totalSize') });
      dl.createEl('dd', { text: formatBytes(presentation.totalSizeBytes) });
    }

    dl.createEl('dt', { text: t('models.details.source') });
    appendDetailsLink(dl.createEl('dd'), presentation.sourceUrl, presentation.sourceUrl, true);

    dl.createEl('dt', { text: t('models.details.license') });
    appendDetailsLink(dl.createEl('dd'), presentation.licenseLabel, presentation.licenseUrl);

    if (presentation.modelCardUrl !== null) {
      dl.createEl('dt', { text: t('models.details.modelCard') });
      appendDetailsLink(
        dl.createEl('dd'),
        t('models.details.modelCard'),
        presentation.modelCardUrl,
      );
    }

    if (presentation.capabilityLabels !== null) {
      dl.createEl('dt', { text: t('models.details.capabilities') });
      dl.createEl('dd', { text: presentation.capabilityLabels.join(', ') });
    }

    if (presentation.installPath !== null) {
      dl.createEl('dt', { text: t('models.details.installPath') });
      dl.createEl('dd', { text: presentation.installPath, cls: 'local-stt-mono' });
    }

    if (presentation.tts !== null) {
      appendDetailsValues(dl, t('models.details.languages'), presentation.tts.languages);
      appendDetailsValues(
        dl,
        t('models.details.availableVoices'),
        presentation.tts.availableVoices.map((voice) =>
          voice.isDefault ? t('models.details.defaultVoice', { voice: voice.label }) : voice.label,
        ),
      );
      appendDetailsValues(
        dl,
        t('models.details.installedVoices'),
        presentation.tts.installedVoices.map((voice) => voice.label),
      );
      if (presentation.tts.supportsSpeedControl) {
        dl.createEl('dt', { text: t('models.details.speedControl') });
        dl.createEl('dd', { text: t('models.details.supported') });
      }
      if (presentation.tts.outputSampleRate !== null) {
        dl.createEl('dt', { text: t('models.details.outputSampleRate') });
        dl.createEl('dd', { text: presentation.tts.outputSampleRate });
      }
    }

    if (presentation.artifacts.length > 0) {
      const table = this.contentEl.createEl('table', { cls: 'local-stt-artifact-table' });
      const thead = table.createEl('thead');
      const headerRow = thead.createEl('tr');
      headerRow.createEl('th', {
        text: t('models.details.files', { count: presentation.artifacts.length }),
      });
      headerRow.createEl('th', { text: t('models.details.size') });

      const tbody = table.createEl('tbody');
      for (const artifact of presentation.artifacts) {
        const tr = tbody.createEl('tr');
        tr.createEl('td', { text: artifact.filename, cls: 'local-stt-mono' });
        tr.createEl('td', { text: formatBytes(artifact.sizeBytes) });
      }
    }
  }
}

export function openModelDetailsModal(
  app: App,
  state: Pick<
    ModelManagerState,
    'catalog' | 'compiledAdapters' | 'compiledRuntimes' | 'installedModels'
  >,
  selection: CatalogModelSelection,
): void {
  const model = state.catalog.models.find((candidate) =>
    matchesModelTriple(candidate, selection.runtimeId, selection.familyId, selection.modelId),
  );
  if (model === undefined) return;

  const installedModel = state.installedModels.find((candidate) =>
    matchesModelTriple(candidate, selection.runtimeId, selection.familyId, selection.modelId),
  );
  const capabilities = resolveEngineCapabilities(
    state.compiledRuntimes,
    state.compiledAdapters,
    selection.runtimeId,
    selection.familyId,
  );
  new ModelDetailsModal(app, model, installedModel ?? null, capabilities).open();
}

export function openSelectedModelDetailsModal(
  app: App,
  manager: Pick<ModelInstallManager, 'getState'>,
  task: 'stt' | 'tts',
): void {
  const state = manager.getState();
  const selection = task === 'stt' ? state.selectedModel : state.selectedTtsModel;
  if (selection?.kind !== 'catalog_model') return;
  openModelDetailsModal(app, state, selection);
}

function appendDetailsValues(
  container: HTMLElement,
  label: string,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  container.createEl('dt', { text: label });
  container.createEl('dd', { text: values.join(', '), cls: 'local-stt-details-values' });
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
