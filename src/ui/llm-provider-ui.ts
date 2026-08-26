import {
  formatLlmProviderName,
  type LlmCleanupFailure,
  type ModelPricing,
  ProviderError,
  type ProviderHealth,
} from '../llm/provider';
import { t } from '../shared/i18n';

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
    case 'permission_denied':
      return { kind: 'permission_denied' };
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
      return t('llm.failure.authInvalid', { provider: providerName });
    case 'permission_denied':
      return t('llm.failure.permissionDenied', { provider: providerName });
    case 'rate_limited':
      return t('llm.failure.rateLimited', { provider: providerName });
    case 'connection_failed':
    case 'timeout':
      return t('llm.failure.network', { provider: providerName });
    case 'model_not_configured':
      return t('llm.failure.modelNotConfigured', { provider: providerName });
    case 'unknown_model':
      return t('llm.failure.unknownModel', { provider: providerName });
    default:
      return t('llm.failure.unknown');
  }
}
