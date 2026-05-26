import {
  formatLlmProviderName,
  type LlmCleanupFailure,
  type ModelOption,
  ProviderError,
  type ProviderHealth,
} from '../llm/provider';

export function providerHealthFromError(error: unknown): ProviderHealth {
  if (!(error instanceof ProviderError)) {
    return { kind: 'unreachable' };
  }

  switch (error.code) {
    case 'auth_invalid':
      return { kind: 'auth_invalid' };
    case 'rate_limited':
      return { kind: 'rate_limited' };
    case 'connection_failed':
    case 'timeout':
      return { kind: 'unreachable' };
    default:
      return { kind: 'unknown' };
  }
}

export function formatCleanupFailureBanner(failure: LlmCleanupFailure): string {
  const providerName = formatLlmProviderName(failure.providerId);

  switch (failure.code) {
    case 'auth_invalid':
      return `${providerName} API key rejected. Check settings.`;
    case 'rate_limited':
      return `${providerName} rate limit hit. Falling back to raw text.`;
    case 'connection_failed':
    case 'timeout':
      return `Network error reaching ${providerName}.`;
    case 'unknown_model':
      return 'Selected model not found.';
    default:
      return 'LLM transform failed. See console.';
  }
}

export function findClosestModelId(input: string, models: readonly ModelOption[]): string | null {
  const normalizedInput = input.toLowerCase();
  const vendorSeparator = normalizedInput.indexOf('/');
  const inputVendor = vendorSeparator > 0 ? normalizedInput.slice(0, vendorSeparator) : null;
  let best: { distance: number; id: string } | null = null;

  for (const model of models) {
    const modelId = model.id.toLowerCase();
    if (inputVendor !== null && !modelId.startsWith(`${inputVendor}/`)) {
      continue;
    }
    const distance = levenshteinDistance(normalizedInput, modelId);
    if (best === null || distance < best.distance) {
      best = { distance, id: model.id };
    }
  }

  if (best === null) {
    return null;
  }

  const threshold = Math.min(4, Math.max(1, Math.ceil(input.length * 0.2)));
  return best.distance <= threshold ? best.id : null;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}
