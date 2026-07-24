export type SidecarLifecycleKind = 'mutation' | 'speech';

export class SidecarLifecycleConflictError extends Error {
  constructor(
    readonly requestedKind: SidecarLifecycleKind,
    readonly activeKind: SidecarLifecycleKind,
  ) {
    super(`Cannot acquire ${requestedKind} lease while ${activeKind} lifecycle is active.`);
    this.name = 'SidecarLifecycleConflictError';
  }
}

export interface SidecarLifecycleLease {
  /**
   * Keeps the gate closed while asynchronous startup work unwinds after the
   * owning lifecycle has already been cancelled. The returned release is
   * idempotent.
   */
  retain(): () => void;
  release(): void;
}

export class SidecarLifecycleGate {
  private mutationToken: symbol | null = null;
  private readonly speechTokens = new Set<symbol>();

  async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const lease = this.acquireMutation();
    try {
      return await operation();
    } finally {
      lease.release();
    }
  }

  acquireMutation(): SidecarLifecycleLease {
    if (this.mutationToken !== null) {
      throw new SidecarLifecycleConflictError('mutation', 'mutation');
    }
    if (this.speechTokens.size > 0) {
      throw new SidecarLifecycleConflictError('mutation', 'speech');
    }

    const token = Symbol('sidecar-mutation');
    this.mutationToken = token;
    return createLease(() => {
      if (this.mutationToken === token) {
        this.mutationToken = null;
      }
    });
  }

  acquireSpeech(): SidecarLifecycleLease {
    if (this.mutationToken !== null) {
      throw new SidecarLifecycleConflictError('speech', 'mutation');
    }

    const token = Symbol('sidecar-speech');
    this.speechTokens.add(token);
    return createLease(() => {
      this.speechTokens.delete(token);
    });
  }
}

function createLease(onReleased: () => void): SidecarLifecycleLease {
  let ownerReleased = false;
  let retainedOperations = 0;

  const releaseIfUnused = (): void => {
    if (ownerReleased && retainedOperations === 0) {
      onReleased();
    }
  };

  return {
    release(): void {
      if (ownerReleased) return;
      ownerReleased = true;
      releaseIfUnused();
    },
    retain(): () => void {
      if (ownerReleased) {
        throw new Error('Cannot retain a released sidecar lifecycle lease.');
      }
      retainedOperations += 1;
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        retainedOperations -= 1;
        releaseIfUnused();
      };
    },
  };
}
