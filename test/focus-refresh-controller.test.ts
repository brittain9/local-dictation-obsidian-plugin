import { describe, expect, it, vi } from 'vitest';

import { FocusRefreshController } from '../src/ui/focus-refresh-controller';

function deferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} {
  let rejectPromise: (error: unknown) => void = () => {};
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('FocusRefreshController', () => {
  it('starts preset and provider refreshes together', async () => {
    const refreshPresets = vi.fn(async () => {});
    const refreshProviders = vi.fn(async () => {});
    const controller = new FocusRefreshController({
      now: () => 1_000,
      refreshPresets,
      refreshProviders,
    });

    controller.request();
    await flushAsyncWork();

    expect(refreshPresets).toHaveBeenCalledTimes(1);
    expect(refreshProviders).toHaveBeenCalledTimes(1);
  });

  it('ignores requests while a refresh is in flight', async () => {
    const pending = deferred();
    const refreshPresets = vi.fn(() => pending.promise);
    const refreshProviders = vi.fn(async () => {});
    const controller = new FocusRefreshController({
      now: () => 1_000,
      refreshPresets,
      refreshProviders,
    });

    controller.request();
    controller.request();
    await flushAsyncWork();

    expect(refreshPresets).toHaveBeenCalledTimes(1);
    expect(refreshProviders).toHaveBeenCalledTimes(1);

    pending.resolve();
    await flushAsyncWork();
  });

  it('uses a one-second cooldown between completed refreshes', async () => {
    let now = 1_000;
    const refreshPresets = vi.fn(async () => {});
    const refreshProviders = vi.fn(async () => {});
    const controller = new FocusRefreshController({
      now: () => now,
      refreshPresets,
      refreshProviders,
    });

    controller.request();
    await flushAsyncWork();

    now = 1_999;
    controller.request();
    await flushAsyncWork();
    expect(refreshPresets).toHaveBeenCalledTimes(1);

    now = 2_000;
    controller.request();
    await flushAsyncWork();
    expect(refreshPresets).toHaveBeenCalledTimes(2);
    expect(refreshProviders).toHaveBeenCalledTimes(2);
  });

  it('absorbs dependency failures and allows a later refresh', async () => {
    let now = 1_000;
    const refreshPresets = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('bad data'))
      .mockResolvedValue(undefined);
    const refreshProviders = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('ollama down'))
      .mockResolvedValue(undefined);
    const controller = new FocusRefreshController({
      now: () => now,
      refreshPresets,
      refreshProviders,
    });

    controller.request();
    await flushAsyncWork();

    now = 2_000;
    controller.request();
    await flushAsyncWork();

    expect(refreshPresets).toHaveBeenCalledTimes(2);
    expect(refreshProviders).toHaveBeenCalledTimes(2);
  });
});
