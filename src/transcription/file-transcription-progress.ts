import { setIcon } from 'obsidian';

import { t } from '../shared/i18n';

export interface FileTranscriptionProgress {
  cancel: () => void;
  path: string;
  progress: number;
}

export class FileTranscriptionProgressIndicator {
  private state: FileTranscriptionProgress | null = null;
  private readonly observer: MutationObserver | null;
  private observing = false;
  private renderQueued = false;

  constructor() {
    this.observer =
      typeof document === 'undefined'
        ? null
        : new MutationObserver(() => {
            this.queueRender();
          });
  }

  update(state: FileTranscriptionProgress | null): void {
    this.state = state;
    if (state === null) {
      this.stopObserving();
    } else if (!this.observing && this.observer !== null) {
      this.observer.observe(document.body, { childList: true, subtree: true });
      this.observing = true;
    }
    this.render();
  }

  dispose(): void {
    this.stopObserving();
    this.state = null;
    this.removeIndicators();
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    if (typeof document === 'undefined') return;
    const state = this.state;
    if (state === null) {
      this.removeIndicators();
      return;
    }

    const titles = document.querySelectorAll<HTMLElement>('.nav-file-title[data-path]');
    const matchingTitles = [...titles].filter((title) => title.dataset.path === state.path);
    for (const indicator of document.querySelectorAll<HTMLElement>('.local-stt-file-progress')) {
      if (!matchingTitles.some((title) => title.contains(indicator))) indicator.remove();
    }
    for (const title of matchingTitles) {
      let indicator = title.querySelector<HTMLButtonElement>(':scope > .local-stt-file-progress');
      if (indicator === null) {
        indicator = title.createEl('button');
        indicator.className = 'local-stt-file-progress clickable-icon';
        indicator.type = 'button';
        setIcon(indicator, 'x');
        indicator.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.state?.cancel();
        });
      }
      const progress = Math.max(0, Math.min(1, state.progress));
      indicator.style.setProperty('--local-stt-file-progress-angle', `${progress * 360}deg`);
      indicator.setAttribute('aria-label', t('audioFile.cancel'));
      indicator.title = t('audioFile.cancel');
    }
  }

  private removeIndicators(): void {
    if (typeof document === 'undefined') return;
    for (const indicator of document.querySelectorAll('.local-stt-file-progress')) {
      indicator.remove();
    }
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observing = false;
  }
}
