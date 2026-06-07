import {
  formatLlmProviderName,
  type LlmCleanupFailure,
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
