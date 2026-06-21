import {
  formatLlmProviderName,
  type LlmCleanupFailure,
  type ModelPricing,
  ProviderError,
  type ProviderHealth,
} from '../llm/provider';

export type PriceTier = 'free' | '$' | '$$' | '$$$' | '$$$$';

// Restaurant-style price tier from a model's pricing, using the industry-standard
// 3:1 input:output blended cost (Artificial Analysis convention). Output is the
// pricier rate but input dominates token volume, so 3:1 reflects typical spend.
// Returns null when pricing is unknown so callers omit the tag.
export function priceTier(pricing: ModelPricing | undefined): PriceTier | null {
  if (pricing === undefined) {
    return null;
  }
  if (pricing.input === 0 && pricing.output === 0) {
    return 'free';
  }
  const blendedPerMillion = (3 * pricing.input + pricing.output) / 4;
  if (blendedPerMillion <= 1) return '$';
  if (blendedPerMillion <= 15) return '$$';
  if (blendedPerMillion <= 40) return '$$$';
  return '$$$$';
}

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
    case 'model_not_configured':
      return `${providerName} model is not configured. Pick one under Where it runs.`;
    case 'unknown_model':
      return `${providerName} model not found. Pick another under Where it runs.`;
    default:
      return 'LLM transform failed. See console.';
  }
}
