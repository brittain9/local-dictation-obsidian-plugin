import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createUserFeedback,
  type FeedbackPresentation,
  type FeedbackPresenter,
} from '../src/shared/user-feedback';

function createHarness(): {
  feedback: ReturnType<typeof createUserFeedback>;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  presentations: FeedbackPresentation[];
  dismissals: Array<ReturnType<typeof vi.fn>>;
} {
  const presentations: FeedbackPresentation[] = [];
  const dismissals: Array<ReturnType<typeof vi.fn>> = [];
  const presenter: FeedbackPresenter = {
    present(presentation) {
      presentations.push(presentation);
      const dismiss = vi.fn();
      dismissals.push(dismiss);
      return { dismiss };
    },
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  return {
    dismissals,
    feedback: createUserFeedback({ logger, presenter }),
    logger,
    presentations,
  };
}

describe('user feedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['information', 5_000, 'debug'],
    ['success', 4_000, 'debug'],
    ['warning', 8_000, 'warn'],
    ['error', 10_000, 'error'],
    ['action-required', 0, 'warn'],
  ] as const)(
    'maps %s feedback to its presentation and log policy',
    (intent, durationMs, level) => {
      const { feedback, logger, presentations } = createHarness();

      feedback.show({ intent, message: 'Speech engine needs attention.' });

      expect(presentations).toEqual([
        expect.objectContaining({
          durationMs,
          message: 'Local Dictation: Speech engine needs attention.',
        }),
      ]);
      expect(logger[level]).toHaveBeenCalledWith(
        'feedback',
        `${intent}: Speech engine needs attention.`,
      );
    },
  );

  it('keeps a technical cause out of user copy while retaining it in the durable log', () => {
    const { feedback, logger, presentations } = createHarness();
    const cause = new Error('native process exited with code 7');

    feedback.show({ cause, intent: 'error', message: 'The speech engine stopped.' });

    expect(presentations[0]?.message).toBe('Local Dictation: The speech engine stopped.');
    expect(logger.error).toHaveBeenCalledWith(
      'feedback',
      'error: The speech engine stopped.',
      cause,
    );
  });

  it('does not add a second product prefix to already branded copy', () => {
    const { feedback, presentations } = createHarness();

    feedback.show({ intent: 'warning', message: 'Local Dictation is unavailable.' });

    expect(presentations[0]?.message).toBe('Local Dictation is unavailable.');
  });

  it('replaces an active keyed notice instead of stacking it', () => {
    const { dismissals, feedback, presentations } = createHarness();

    feedback.show({ intent: 'warning', key: 'sidecar-startup', message: 'First failure.' });
    feedback.show({ intent: 'warning', key: 'sidecar-startup', message: 'Second failure.' });

    expect(dismissals[0]).toHaveBeenCalledOnce();
    expect(presentations).toHaveLength(2);
  });

  it('releases a transient keyed handle when its presentation duration elapses', () => {
    vi.useFakeTimers();
    const { dismissals, feedback } = createHarness();

    feedback.show({ intent: 'warning', key: 'sidecar-startup', message: 'First failure.' });
    vi.advanceTimersByTime(8_000);
    feedback.show({ intent: 'warning', key: 'sidecar-startup', message: 'Later failure.' });

    expect(dismissals[0]).not.toHaveBeenCalled();
  });

  it('dismisses an actionable notice before invoking its action', () => {
    const { dismissals, feedback, presentations } = createHarness();
    const run = vi.fn();

    feedback.show({
      action: { label: 'Update speech engine', run },
      intent: 'action-required',
      key: 'sidecar-version-drift',
      message: 'The installed speech engine is out of date.',
    });
    presentations[0]?.action?.run();

    expect(dismissals[0]).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(dismissals[0]?.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('dismisses keyed feedback without presenting a replacement', () => {
    const { dismissals, feedback, presentations } = createHarness();
    feedback.show({
      intent: 'warning',
      key: 'recoverable-action',
      message: 'Recovery is available.',
    });

    feedback.dismiss('recoverable-action');

    expect(dismissals[0]).toHaveBeenCalledOnce();
    expect(presentations).toHaveLength(1);
  });
});
