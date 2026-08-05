import type { PluginSettings } from '../settings/plugin-settings';
import { type ClipboardProvider, tryWriteClipboardText } from '../shared/clipboard';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface FinalizedUtteranceAutoCopyDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getClipboard: ClipboardProvider;
  getSettings: () => Pick<PluginSettings, 'autoCopyFinalizedUtterances'>;
}

export class FinalizedUtteranceAutoCopy {
  private disposed = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: FinalizedUtteranceAutoCopyDependencies) {}

  copyAcceptedUtterance(text: string): Promise<boolean> {
    const normalized = text.trim();
    if (
      this.disposed ||
      !this.dependencies.getSettings().autoCopyFinalizedUtterances ||
      normalized.length === 0
    ) {
      return Promise.resolve(false);
    }

    const copy = this.writeQueue.then(() => (this.disposed ? false : this.write(normalized)));
    this.writeQueue = copy.then(
      () => {},
      () => {},
    );
    return copy;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async write(text: string): Promise<boolean> {
    const copied = await tryWriteClipboardText(this.dependencies.getClipboard, text);
    if (!copied && !this.disposed) {
      try {
        this.dependencies.feedback.show({
          intent: 'error',
          key: 'finalized-utterance-auto-copy-failed',
          message: t('notice.finalizedUtteranceAutoCopyFailed'),
        });
      } catch {
        // This runs in the background. A failing feedback presenter must not
        // create an unhandled rejection or expose clipboard failure details.
      }
    }
    return copied;
  }
}
