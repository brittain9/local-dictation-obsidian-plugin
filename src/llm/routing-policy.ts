import { isLlmProviderId, type LlmProviderId, type LlmRoutingPolicy } from './provider';

export function normalizeLlmRoutingPolicy(value: unknown): LlmRoutingPolicy | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'fixed' && isLlmProviderId(candidate.providerId)) {
    return { kind: 'fixed', providerId: candidate.providerId };
  }
  if (
    candidate.kind !== 'transcript_size' ||
    !isLlmProviderId(candidate.defaultProviderId) ||
    !isLlmProviderId(candidate.largeTranscriptProviderId) ||
    typeof candidate.thresholdChars !== 'number' ||
    !Number.isInteger(candidate.thresholdChars) ||
    candidate.thresholdChars < 0
  ) {
    return null;
  }
  if (candidate.defaultProviderId === candidate.largeTranscriptProviderId) {
    return { kind: 'fixed', providerId: candidate.defaultProviderId };
  }
  return {
    defaultProviderId: candidate.defaultProviderId,
    kind: 'transcript_size',
    largeTranscriptProviderId: candidate.largeTranscriptProviderId,
    thresholdChars: candidate.thresholdChars,
  };
}

export function selectLlmProviderId(
  policy: LlmRoutingPolicy,
  transcriptChars: number,
): LlmProviderId {
  if (policy.kind === 'fixed') {
    return policy.providerId;
  }
  return transcriptChars <= policy.thresholdChars
    ? policy.defaultProviderId
    : policy.largeTranscriptProviderId;
}

export function activeLlmProviderIds(policy: LlmRoutingPolicy | null): LlmProviderId[] {
  if (policy === null) {
    return [];
  }
  if (policy.kind === 'fixed') {
    return [policy.providerId];
  }
  return [policy.defaultProviderId, policy.largeTranscriptProviderId];
}
