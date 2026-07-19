import type { App } from 'obsidian';
import { Modal } from 'obsidian';

import {
  createInstallProgressElement,
  updateInstallProgressElement,
} from '../models/model-install-progress';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import {
  type ActiveSidecarInstall,
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import {
  DEFAULT_RELEASE_BASE_URL,
  detectPlatformAssetForCurrentEnv,
  type SidecarInstallVariant,
} from '../sidecar/sidecar-installer';
import type { InstallCopy } from './sidecar-install-copy';

export interface SidecarInstallModalOptions {
  beforeReplace?: (() => Promise<void>) | undefined;
  copy: InstallCopy;
  feedback: Pick<UserFeedback, 'show'>;
  manager: SidecarInstallManager;
  onInstalled: () => Promise<void>;
  onVariantInstalled?: ((variant: SidecarInstallVariant) => Promise<void>) | undefined;
  pluginDirectory: string;
  variants: readonly SidecarInstallVariant[];
  version: string;
}

export class SidecarInstallModal extends Modal {
  private inlineFailureVisible = false;
  private installProgressEl: HTMLDivElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private wasActive = false;

  constructor(
    app: App,
    private readonly options: SidecarInstallModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.inlineFailureVisible = true;
    this.modalEl.addClass('local-stt-sidecar-install');
    this.titleEl.setText(this.options.copy.title);
    this.unsubscribe = this.options.manager.subscribe(() => {
      this.handleManagerChange();
    });
    this.render();
  }

  override onClose(): void {
    this.inlineFailureVisible = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private handleManagerChange(): void {
    const state = this.options.manager.getState();

    if (state.activeInstall !== null) {
      this.wasActive = true;

      if (this.installProgressEl !== null) {
        updateInstallProgressElement(
          this.installProgressEl,
          buildSidecarProgressState(state.activeInstall),
        );
        return;
      }

      this.render();
      return;
    }

    if (this.wasActive && state.lastError === null) {
      this.close();
      return;
    }

    this.wasActive = false;
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.installProgressEl = null;

    const state = this.options.manager.getState();

    if (state.activeInstall !== null) {
      this.wasActive = true;
      this.renderProgress(state.activeInstall);
      return;
    }

    if (state.lastError !== null) {
      this.renderFailure();
      return;
    }

    this.renderPreInstall();
  }

  private renderPreInstall(): void {
    let downloads: Array<{ asset: string; variant: SidecarInstallVariant }>;
    try {
      downloads = this.options.variants.map((variant) => ({
        asset: detectPlatformAssetForCurrentEnv(variant),
        variant,
      }));
    } catch {
      // Currently the only path here is Intel Mac (CUDA-on-macOS is unreachable
      // because callers gate the variant on platform). The unsupported view
      // gives the user a clear answer instead of a render-time crash that
      // bubbles to a generic Notice.
      this.renderUnsupported();
      return;
    }

    this.contentEl.createEl('p', { text: this.options.copy.bodyText });

    const details = this.contentEl.createEl('dl', { cls: 'local-stt-details-grid' });
    const appendRow = (label: string, value: string): void => {
      details.createEl('dt', { text: label });
      details.createEl('dd', { text: value });
    };
    const releaseTagUrl = `${DEFAULT_RELEASE_BASE_URL.replace(/\/download$/, '/tag')}/${this.options.version}`;
    for (const download of downloads) {
      details.createEl('dt', {
        text:
          downloads.length === 1
            ? t('setup.sidecar.modal.download')
            : t('setup.sidecar.modal.variantDownload', {
                variant: download.variant.toUpperCase(),
              }),
      });
      const downloadDd = details.createEl('dd');
      downloadDd.createEl('a', {
        text: download.asset,
        href: releaseTagUrl,
        attr: { rel: 'noopener noreferrer', target: '_blank' },
      });
    }
    appendRow(t('setup.sidecar.modal.version'), this.options.version);

    const buttons = this.contentEl.createDiv({ cls: 'local-stt-sidecar-install__buttons' });
    buttons.createEl('button', { text: t('common.later') }).addEventListener('click', () => {
      this.close();
    });
    buttons
      .createEl('button', {
        cls: 'mod-cta',
        text: this.options.copy.primaryButtonText,
      })
      .addEventListener('click', () => {
        this.startInstall();
      });
  }

  private renderProgress(active: ActiveSidecarInstall): void {
    const progressState = buildSidecarProgressState(active);
    const fragment = createFragment();
    this.installProgressEl = createInstallProgressElement(progressState);
    fragment.append(this.installProgressEl);
    this.contentEl.append(fragment);

    const buttons = this.contentEl.createDiv({ cls: 'local-stt-sidecar-install__buttons' });
    buttons.createEl('button', {
      cls: 'mod-cta',
      text:
        active.phase === 'canceling'
          ? t('setup.sidecar.modal.cancelling')
          : t('setup.sidecar.modal.downloading'),
    }).disabled = true;
    buttons.createEl('button', { text: t('common.close') }).addEventListener('click', () => {
      this.close();
    });
  }

  private renderUnsupported(): void {
    this.contentEl.createEl('p', {
      cls: 'local-stt-sidecar-install__status local-stt-sidecar-install__status--error',
      text: t('setup.sidecar.modal.unsupportedPlatform'),
    });

    const buttons = this.contentEl.createDiv({ cls: 'local-stt-sidecar-install__buttons' });
    buttons
      .createEl('button', { cls: 'mod-cta', text: t('common.close') })
      .addEventListener('click', () => {
        this.close();
      });
  }

  private renderFailure(): void {
    this.contentEl.createEl('p', {
      cls: 'local-stt-sidecar-install__status local-stt-sidecar-install__status--error',
      text: t('setup.sidecar.modal.genericInstallError'),
    });

    const buttons = this.contentEl.createDiv({ cls: 'local-stt-sidecar-install__buttons' });
    buttons
      .createEl('button', {
        cls: 'mod-cta',
        text: t('setup.sidecar.modal.retryDownload'),
      })
      .addEventListener('click', () => {
        this.startInstall();
      });
    buttons.createEl('button', { text: t('common.close') }).addEventListener('click', () => {
      this.close();
    });
  }

  private startInstall(): void {
    try {
      this.options.manager.installBatch({
        beforeReplace: this.options.beforeReplace,
        failureFeedback: {
          isInlineVisible: () => this.inlineFailureVisible,
          message: t('setup.sidecar.modal.installFailureNotice'),
        },
        onInstalled: this.options.onInstalled,
        onVariantInstalled: this.options.onVariantInstalled,
        pluginDirectory: this.options.pluginDirectory,
        successNotice: this.options.copy.successNotice,
        variants: this.options.variants,
        version: this.options.version,
      });
    } catch (error) {
      this.options.feedback.show({
        cause: error,
        intent: 'error',
        message: t('setup.sidecar.modal.startFailed'),
      });
    }
  }
}
