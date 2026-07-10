import type { EventRef } from 'obsidian';

export interface PinnableLeaf {
  getViewState(): { pinned?: boolean };
  offref(ref: EventRef): void;
  on(name: 'pinned-change', callback: (pinned: boolean) => unknown): EventRef;
  setPinned(pinned: boolean): void;
}

export interface TemporaryLeafPinLease {
  release(): void;
}

interface SharedPinLease {
  leaseCount: number;
  ownsTemporaryPin: boolean;
  pinnedChangeRef: EventRef | null;
}

/**
 * Coordinates temporary pin ownership per leaf. A single shared record owns the
 * pin mutation and listener even when an older session is still draining while
 * a newer session targets the same editor leaf.
 */
export class TemporaryLeafPinLeaseManager {
  private readonly leasesByLeaf = new WeakMap<PinnableLeaf, SharedPinLease>();

  acquire(leaf: PinnableLeaf, isTargetLive: () => boolean): TemporaryLeafPinLease {
    const existing = this.leasesByLeaf.get(leaf);
    if (existing !== undefined) {
      existing.leaseCount += 1;
      return this.createLease(leaf, existing, isTargetLive);
    }

    const shared: SharedPinLease = {
      leaseCount: 1,
      ownsTemporaryPin: leaf.getViewState().pinned !== true,
      pinnedChangeRef: null,
    };
    const pinnedChangeRef = leaf.on('pinned-change', (pinned) => {
      if (!pinned) {
        shared.ownsTemporaryPin = false;
      }
    });
    shared.pinnedChangeRef = pinnedChangeRef;
    this.leasesByLeaf.set(leaf, shared);

    if (shared.ownsTemporaryPin) {
      try {
        leaf.setPinned(true);
      } catch (error) {
        leaf.offref(pinnedChangeRef);
        this.leasesByLeaf.delete(leaf);
        throw error;
      }
    }

    return this.createLease(leaf, shared, isTargetLive);
  }

  private createLease(
    leaf: PinnableLeaf,
    shared: SharedPinLease,
    isTargetLive: () => boolean,
  ): TemporaryLeafPinLease {
    let released = false;

    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;

        if (this.leasesByLeaf.get(leaf) !== shared) {
          return;
        }

        shared.leaseCount -= 1;
        if (shared.leaseCount > 0) {
          return;
        }

        if (shared.pinnedChangeRef !== null) {
          leaf.offref(shared.pinnedChangeRef);
        }
        this.leasesByLeaf.delete(leaf);

        if (shared.ownsTemporaryPin && isTargetLive() && leaf.getViewState().pinned === true) {
          leaf.setPinned(false);
        }
      },
    };
  }
}
