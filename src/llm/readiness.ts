import { validateOpenAiCompatibleBaseUrl } from './openai-compatible-url';
import {
  getProviderModel,
  type LlmProviderConfigurations,
  type LlmProviderId,
  type LlmRoutingPolicy,
} from './provider';
import { activeLlmProviderIds, normalizeLlmRoutingPolicy } from './routing-policy';

export type LlmReadinessIssueCode =
  | 'api_key_missing'
  | 'base_url_invalid'
  | 'model_missing'
  | 'provider_missing'
  | 'routing_invalid';

export type LlmReadiness =
  | { ready: true }
  | {
      ready: false;
      issue: {
        code: LlmReadinessIssueCode;
        message?: string;
        providerId?: LlmProviderId;
      };
    };

export function resolveLlmReadiness(options: {
  configurations: LlmProviderConfigurations;
  getSecret: (secretId: string) => string;
  policy: LlmRoutingPolicy | null;
}): LlmReadiness {
  if (options.policy === null) {
    return { issue: { code: 'provider_missing' }, ready: false };
  }
  const policy = normalizeLlmRoutingPolicy(options.policy);
  if (policy === null) {
    return { issue: { code: 'routing_invalid' }, ready: false };
  }

  for (const providerId of activeLlmProviderIds(policy)) {
    if (getProviderModel(options.configurations, providerId).length === 0) {
      return { issue: { code: 'model_missing', providerId }, ready: false };
    }
    if (providerId === 'openrouter') {
      const secretId = options.configurations.openrouter.secretId;
      if (secretId.length === 0 || options.getSecret(secretId).length === 0) {
        return { issue: { code: 'api_key_missing', providerId }, ready: false };
      }
    }
    if (providerId === 'openai_compatible') {
      const validation = validateOpenAiCompatibleBaseUrl(
        options.configurations.openai_compatible.baseUrl,
      );
      if (!validation.valid) {
        return {
          issue: {
            code: 'base_url_invalid',
            providerId,
          },
          ready: false,
        };
      }
    }
  }
  return { ready: true };
}
