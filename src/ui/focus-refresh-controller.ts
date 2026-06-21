const FOCUS_REFRESH_COOLDOWN_MS = 1_000;

interface FocusRefreshControllerDependencies {
  now: () => number;
  refreshPresets: () => Promise<void>;
  refreshProviders: () => Promise<void>;
}

export class FocusRefreshController {
  private inFlight: Promise<void> | null = null;
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly dependencies: FocusRefreshControllerDependencies) {}

  request(): void {
    const now = this.dependencies.now();
    if (this.inFlight !== null || now - this.lastStartedAt < FOCUS_REFRESH_COOLDOWN_MS) {
      return;
    }

    this.lastStartedAt = now;
    const operation = Promise.allSettled([
      Promise.resolve().then(() => this.dependencies.refreshPresets()),
      Promise.resolve().then(() => this.dependencies.refreshProviders()),
    ]).then(() => undefined);
    const tracked = operation.finally(() => {
      if (this.inFlight === tracked) {
        this.inFlight = null;
      }
    });
    this.inFlight = tracked;
  }
}
