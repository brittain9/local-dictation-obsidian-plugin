import type { EventRef } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { type PinnableLeaf, TemporaryLeafPinLeaseManager } from '../src/editor/temporary-leaf-pin';

describe('TemporaryLeafPinLeaseManager', () => {
  it('temporarily pins an unpinned leaf and restores it after the target is no longer needed', () => {
    const leaf = new FakeLeaf(false);
    const manager = new TemporaryLeafPinLeaseManager();
    let targetLive = true;

    const lease = manager.acquire(leaf, () => targetLive);

    expect(leaf.pinned).toBe(true);
    expect(leaf.setPinned).toHaveBeenCalledTimes(1);
    expect(leaf.listenerCount).toBe(1);

    lease.release();
    targetLive = false;

    expect(leaf.setPinned).toHaveBeenNthCalledWith(2, false);
    expect(leaf.listenerCount).toBe(0);
  });

  it('observes but never mutates a leaf that was already pinned', () => {
    const leaf = new FakeLeaf(true);
    const manager = new TemporaryLeafPinLeaseManager();

    const lease = manager.acquire(leaf, () => true);
    lease.release();

    expect(leaf.pinned).toBe(true);
    expect(leaf.setPinned).not.toHaveBeenCalled();
    expect(leaf.listenerCount).toBe(0);
  });

  it('permanently relinquishes ownership when the user unpins', () => {
    const leaf = new FakeLeaf(false);
    const manager = new TemporaryLeafPinLeaseManager();
    const lease = manager.acquire(leaf, () => true);

    leaf.userSetPinned(false);
    leaf.userSetPinned(true);
    lease.release();

    expect(leaf.pinned).toBe(true);
    expect(leaf.setPinned).toHaveBeenCalledTimes(1);
    expect(leaf.listenerCount).toBe(0);
  });

  it('restores a shared temporary pin only after the final overlapping lease releases', () => {
    const leaf = new FakeLeaf(false);
    const manager = new TemporaryLeafPinLeaseManager();
    const first = manager.acquire(leaf, () => true);
    const second = manager.acquire(leaf, () => true);

    first.release();

    expect(leaf.pinned).toBe(true);
    expect(leaf.setPinned).toHaveBeenCalledTimes(1);

    second.release();

    expect(leaf.pinned).toBe(false);
    expect(leaf.setPinned).toHaveBeenCalledTimes(2);
    expect(leaf.listenerCount).toBe(0);
  });

  it('makes repeated release idempotent', () => {
    const leaf = new FakeLeaf(false);
    const manager = new TemporaryLeafPinLeaseManager();
    const lease = manager.acquire(leaf, () => true);

    lease.release();
    lease.release();

    expect(leaf.setPinned).toHaveBeenCalledTimes(2);
    expect(leaf.listenerCount).toBe(0);
  });

  it('does not mutate a leaf whose exact target surface is no longer live', () => {
    const leaf = new FakeLeaf(false);
    const manager = new TemporaryLeafPinLeaseManager();
    const lease = manager.acquire(leaf, () => false);

    lease.release();

    expect(leaf.pinned).toBe(true);
    expect(leaf.setPinned).toHaveBeenCalledTimes(1);
    expect(leaf.listenerCount).toBe(0);
  });
});

class FakeLeaf implements PinnableLeaf {
  private readonly listeners = new Map<EventRef, (pinned: boolean) => void>();
  private nextRef = 0;
  public pinned: boolean;
  readonly setPinned = vi.fn((pinned: boolean) => {
    this.pinned = pinned;
    this.emitPinnedChange(pinned);
  });

  constructor(pinned: boolean) {
    this.pinned = pinned;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  getViewState(): { pinned?: boolean } {
    return { pinned: this.pinned };
  }

  on(_name: 'pinned-change', callback: (pinned: boolean) => unknown): EventRef {
    const ref = { id: this.nextRef++ } as unknown as EventRef;
    this.listeners.set(ref, callback);
    return ref;
  }

  offref(ref: EventRef): void {
    this.listeners.delete(ref);
  }

  userSetPinned(pinned: boolean): void {
    this.pinned = pinned;
    this.emitPinnedChange(pinned);
  }

  private emitPinnedChange(pinned: boolean): void {
    for (const listener of this.listeners.values()) {
      listener(pinned);
    }
  }
}
