import { describe, expect, it, vi } from 'vitest';

import { SetupReadyActions } from '../src/setup/setup-ready-actions';

function createHarness(
  overrides: Partial<ConstructorParameters<typeof SetupReadyActions>[0]> = {},
): {
  actions: SetupReadyActions;
  closeWizard: ReturnType<typeof vi.fn>;
  events: string[];
  feedback: { show: ReturnType<typeof vi.fn> };
  onCompleted: ReturnType<typeof vi.fn<() => Promise<void>>>;
  startDictation: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const events: string[] = [];
  const closeWizard = vi.fn(() => events.push('closed'));
  const feedback = { show: vi.fn() };
  const onCompleted = vi.fn(async () => {
    events.push('completed');
  });
  const startDictation = vi.fn(async () => {
    events.push('started');
  });

  return {
    actions: new SetupReadyActions({
      closeWizard,
      feedback,
      hasDictationTarget: () => true,
      isDictationBusy: () => false,
      onCompleted,
      startDictation,
      ...overrides,
    }),
    closeWizard,
    events,
    feedback,
    onCompleted,
    startDictation,
  };
}

describe('setup ready actions', () => {
  it('completes setup, closes the wizard, then starts one ordinary dictation session', async () => {
    const harness = createHarness();

    await harness.actions.tryDictationNow();

    expect(harness.events).toEqual(['completed', 'closed', 'started']);
    expect(harness.startDictation).toHaveBeenCalledOnce();
  });

  it('keeps Done as a completion-only path', async () => {
    const harness = createHarness();

    await harness.actions.done();

    expect(harness.events).toEqual(['completed', 'closed']);
    expect(harness.startDictation).not.toHaveBeenCalled();
  });

  it.each([
    {
      expectedMessage: 'Wait for the current dictation to finish, then try again.',
      hasDictationTarget: true,
      isDictationBusy: true,
    },
    {
      expectedMessage: 'Open a Markdown note in editing mode, then try dictation again.',
      hasDictationTarget: false,
      isDictationBusy: false,
    },
  ])('keeps the wizard open when the dictation prerequisite is unavailable', async ({
    expectedMessage,
    hasDictationTarget,
    isDictationBusy,
  }) => {
    const harness = createHarness({
      hasDictationTarget: () => hasDictationTarget,
      isDictationBusy: () => isDictationBusy,
    });

    await harness.actions.tryDictationNow();

    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'setup-wizard-prerequisite',
      message: expectedMessage,
    });
    expect(harness.onCompleted).not.toHaveBeenCalled();
    expect(harness.closeWizard).not.toHaveBeenCalled();
    expect(harness.startDictation).not.toHaveBeenCalled();
  });

  it('keeps the wizard open and does not start when setup completion fails', async () => {
    const cause = new Error('settings write failed');
    const harness = createHarness({ onCompleted: vi.fn().mockRejectedValue(cause) });

    await harness.actions.tryDictationNow();

    expect(harness.feedback.show).toHaveBeenCalledWith({
      cause,
      intent: 'error',
      key: 'setup-wizard-completion',
      message: "Couldn't finish setup. Try again.",
    });
    expect(harness.closeWizard).not.toHaveBeenCalled();
    expect(harness.startDictation).not.toHaveBeenCalled();
  });

  it('coalesces concurrent ready actions into one completion and one session start', async () => {
    let completeSetup: (() => void) | undefined;
    const onCompleted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeSetup = resolve;
        }),
    );
    const harness = createHarness({ onCompleted });

    const first = harness.actions.tryDictationNow();
    const second = harness.actions.tryDictationNow();
    completeSetup?.();
    await Promise.all([first, second]);

    expect(onCompleted).toHaveBeenCalledOnce();
    expect(harness.startDictation).toHaveBeenCalledOnce();
  });
});
