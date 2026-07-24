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
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: FinalizedUtteranceAutoCopyDependencies) {}

  copyAcceptedUtterance(text: string): Promise<boolean> {
    const normalized = text.trim();
    if (!this.dependencies.getSettings().autoCopyFinalizedUtterances || normalized.length === 0) {
      return Promise.resolve(false);
    }

    const copy = this.writeQueue.then(() => this.write(normalized));
    this.writeQueue = copy.then(
      () => {},
      () => {},
    );
    return copy;
  }

  private async write(text: string): Promise<boolean> {
    const copied = await tryWriteClipboardText(this.dependencies.getClipboard, text);
    if (!copied) {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'finalized-utterance-auto-copy-failed',
        message: t('notice.finalizedUtteranceAutoCopyFailed'),
      });
    }
    return copied;
  }
}
