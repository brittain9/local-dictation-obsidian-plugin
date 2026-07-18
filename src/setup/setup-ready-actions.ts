import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface SetupReadyActionDependencies {
  closeWizard: () => void;
  feedback: Pick<UserFeedback, 'show'>;
  hasDictationTarget: () => boolean;
  isDictationBusy: () => boolean;
  onCompleted: () => Promise<void>;
  startDictation: () => Promise<void>;
}

export class SetupReadyActions {
  private pending = false;

  constructor(private readonly dependencies: SetupReadyActionDependencies) {}

  async done(): Promise<void> {
    await this.complete(false);
  }

  async tryDictationNow(): Promise<void> {
    if (this.pending) {
      return;
    }

    if (this.dependencies.isDictationBusy()) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'setup-wizard-prerequisite',
        message: t('setup.ready.waitForDictation'),
      });
      return;
    }

    if (!this.dependencies.hasDictationTarget()) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'setup-wizard-prerequisite',
        message: t('setup.ready.openMarkdownNote'),
      });
      return;
    }

    await this.complete(true);
  }

  private async complete(startDictation: boolean): Promise<void> {
    if (this.pending) {
      return;
    }

    this.pending = true;
    try {
      try {
        await this.dependencies.onCompleted();
      } catch (cause) {
        this.dependencies.feedback.show({
          cause,
          intent: 'error',
          key: 'setup-wizard-completion',
          message: t('setup.ready.completionFailed'),
        });
        return;
      }

      this.dependencies.closeWizard();
      if (startDictation) {
        await this.dependencies.startDictation();
      }
    } finally {
      this.pending = false;
    }
  }
}
