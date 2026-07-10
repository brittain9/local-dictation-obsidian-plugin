import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { formatBytes } from '../shared/format-utils';
import type { UserFeedback } from '../shared/user-feedback';
import { buildCapabilityLabels } from './capability-view';
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

const EXTERNAL_FILE_ENGINES: Array<{
  label: string;
  selection: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;
}> = [
  {
    label: 'Moonshine (ONNX Runtime)',
    selection: { familyId: 'moonshine', runtimeId: 'onnx_runtime' },
  },
  {
    label: 'Whisper (whisper.cpp)',
    selection: { familyId: 'whisper', runtimeId: 'whisper_cpp' },
  },
];

export class ExternalModelFileModal extends Modal {
  private engine: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;
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
    this.titleEl.setText('Use external file');
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: 'Validate an absolute model file path. External files bypass managed downloads and managed updates.',
    });

    new Setting(this.contentEl)
      .setName('Model family')
      .setDesc('Choose the runtime and graph format for the external model.')
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
          }
        });
      });

    new Setting(this.contentEl)
      .setName('Model file path')
      .setDesc('Enter the absolute path to the primary model artifact.')
      .addText((text) => {
        text.setPlaceholder('/absolute/path/to/ggml-small.en-q5_1.bin');
        text.setValue(this.currentPath);
        this.inputEl = text.inputEl;
      });

    this.inputEl?.focus();

    new Setting(this.contentEl).addButton((button) => {
      button
        .setCta()
        .setButtonText('Validate and use')
        .onClick(async () => {
          const nextPath = this.inputEl?.value.trim() ?? '';

          try {
            await this.dependencies.manager.validateAndSelectExternalFile(nextPath, this.engine);
            await this.dependencies.onChanged();
            this.dependencies.feedback.show({
              intent: 'success',
              message: 'External model file validated and selected.',
            });
            this.close();
          } catch (error) {
            this.dependencies.feedback.show({
              cause: error,
              intent: 'error',
              message:
                'Could not validate the external model file. Check the file path and model family, then try again.',
            });
          }
        });
    });
  }

  private initialEngine(): Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'> {
    const selected = this.dependencies.manager.getState().selectedModel;
    if (selected?.kind === 'external_file') {
      const selectedKey = engineKey(selected);
      const option = EXTERNAL_FILE_ENGINES.find(
        (candidate) => engineKey(candidate.selection) === selectedKey,
      );
      if (option !== undefined) {
        return option.selection;
      }
    }
    return (
      EXTERNAL_FILE_ENGINES[1]?.selection ?? {
        familyId: 'whisper',
        runtimeId: 'whisper_cpp',
      }
    );
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
    this.contentEl.createEl('p', { text: this.model.summary });

    const dl = this.contentEl.createEl('dl', { cls: 'local-stt-details-grid' });

    const totalSize = getTotalModelSize(this.model);
    if (totalSize > 0) {
      dl.createEl('dt', { text: 'Total size' });
      dl.createEl('dd', { text: formatBytes(totalSize) });
    }

    dl.createEl('dt', { text: 'Source' });
    appendDetailsLink(dl.createEl('dd'), this.model.sourceUrl, this.model.sourceUrl, true);

    dl.createEl('dt', { text: 'License' });
    appendDetailsLink(dl.createEl('dd'), this.model.licenseLabel, this.model.licenseUrl);

    if (this.capabilities !== null) {
      dl.createEl('dt', { text: 'Capabilities' });
      dl.createEl('dd', { text: buildCapabilityLabels(this.capabilities).join(', ') });
    }

    if (this.installPath !== null) {
      dl.createEl('dt', { text: 'Install path' });
      dl.createEl('dd', { text: this.installPath, cls: 'local-stt-mono' });
    }

    if (this.model.artifacts.length > 0) {
      const table = this.contentEl.createEl('table', { cls: 'local-stt-artifact-table' });
      const thead = table.createEl('thead');
      const headerRow = thead.createEl('tr');
      headerRow.createEl('th', { text: `Files (${this.model.artifacts.length})` });
      headerRow.createEl('th', { text: 'Size' });

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
