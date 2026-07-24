export interface SpeechSessionPredicates {
  isDictationBusy(): boolean;
  isReadAloudActive(): boolean;
}

export class SidecarInUseError extends Error {
  constructor(readonly userMessage: string) {
    super('Sidecar operation blocked by an active speech session.');
    this.name = 'SidecarInUseError';
  }
}

export function createSidecarInUsePredicate(predicates: SpeechSessionPredicates): () => boolean {
  return () => predicates.isDictationBusy() || predicates.isReadAloudActive();
}

export function assertSidecarIdle(isSidecarInUse: () => boolean, userMessage: string): void {
  if (isSidecarInUse()) {
    throw new SidecarInUseError(userMessage);
  }
}
