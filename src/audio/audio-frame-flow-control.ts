import type { QueueBackpressureTier } from '../sidecar/protocol';

interface FlowWaiter {
  abortSignal: AbortSignal;
  onAbort: () => void;
  resolve: () => void;
}

export class AudioFrameFlowControl {
  private readonly waiters = new Set<FlowWaiter>();
  private tier: QueueBackpressureTier = 'normal';

  setTier(tier: QueueBackpressureTier): void {
    this.tier = tier;
    if (tier !== 'normal') {
      return;
    }

    for (const waiter of [...this.waiters]) {
      this.release(waiter);
      waiter.resolve();
    }
  }

  waitUntilReady(abortSignal: AbortSignal): Promise<void> {
    if (abortSignal.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.tier === 'normal') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: FlowWaiter = {
        abortSignal,
        onAbort: () => {
          this.release(waiter);
          reject(createAbortError());
        },
        resolve,
      };
      this.waiters.add(waiter);
      abortSignal.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  private release(waiter: FlowWaiter): void {
    waiter.abortSignal.removeEventListener('abort', waiter.onAbort);
    this.waiters.delete(waiter);
  }
}

function createAbortError(): Error {
  const error = new Error('Audio frame flow was cancelled.');
  error.name = 'AbortError';
  return error;
}
