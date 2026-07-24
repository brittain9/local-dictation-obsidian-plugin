import { describe, expect, it } from 'vitest';

import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from '../src/sidecar/sidecar-lifecycle-gate';

describe('SidecarLifecycleGate', () => {
  it('rejects mutation synchronously while any speech lifecycle is held', () => {
    const gate = new SidecarLifecycleGate();
    const dictation = gate.acquireSpeech();
    const readAloud = gate.acquireSpeech();

    expect(() => gate.acquireMutation()).toThrow(
      new SidecarLifecycleConflictError('mutation', 'speech'),
    );

    dictation.release();
    expect(() => gate.acquireMutation()).toThrow(
      new SidecarLifecycleConflictError('mutation', 'speech'),
    );

    readAloud.release();
    expect(() => gate.acquireMutation()).not.toThrow();
  });

  it('rejects speech and another mutation synchronously while mutation is held', () => {
    const gate = new SidecarLifecycleGate();
    const mutation = gate.acquireMutation();

    expect(() => gate.acquireSpeech()).toThrow(
      new SidecarLifecycleConflictError('speech', 'mutation'),
    );
    expect(() => gate.acquireMutation()).toThrow(
      new SidecarLifecycleConflictError('mutation', 'mutation'),
    );

    mutation.release();
    expect(() => gate.acquireSpeech()).not.toThrow();
  });

  it('keeps a released owner active until retained asynchronous work unwinds', () => {
    const gate = new SidecarLifecycleGate();
    const speech = gate.acquireSpeech();
    const releaseStartOperation = speech.retain();

    speech.release();
    speech.release();
    expect(() => gate.acquireMutation()).toThrow(
      new SidecarLifecycleConflictError('mutation', 'speech'),
    );

    releaseStartOperation();
    releaseStartOperation();
    const mutation = gate.acquireMutation();
    mutation.release();
  });

  it('guards a direct restart for its full asynchronous lifecycle', async () => {
    const gate = new SidecarLifecycleGate();
    let finishRestart: (() => void) | undefined;
    const restart = () =>
      new Promise<void>((resolve) => {
        finishRestart = resolve;
      });

    const restarting = gate.runMutation(restart);
    expect(() => gate.acquireSpeech()).toThrow(
      new SidecarLifecycleConflictError('speech', 'mutation'),
    );

    finishRestart?.();
    await restarting;
    const speech = gate.acquireSpeech();
    speech.release();
  });

  it('does not invoke direct restart while speech is active', async () => {
    const gate = new SidecarLifecycleGate();
    const speech = gate.acquireSpeech();
    let restarted = false;

    await expect(
      gate.runMutation(async () => {
        restarted = true;
      }),
    ).rejects.toBeInstanceOf(SidecarLifecycleConflictError);

    expect(restarted).toBe(false);
    speech.release();
  });
});
