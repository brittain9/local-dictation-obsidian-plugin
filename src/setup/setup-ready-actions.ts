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
        message: 'Wait for the current dictation to finish, then try again.',
      });
      return;
    }

    if (!this.dependencies.hasDictationTarget()) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'setup-wizard-prerequisite',
        message: 'Open a Markdown note in editing mode, then try dictation again.',
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
          message: "Couldn't finish setup. Try again.",
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
