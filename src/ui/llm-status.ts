import {
  formatLlmProviderName,
  type LlmProviderId,
  type ModelOption,
  type ProviderHealth,
} from '../llm/provider';
import { t } from '../shared/i18n';

export type InlineStatusVariant = 'warning' | 'info';

export interface InlineStatus {
  text: string;
  variant: InlineStatusVariant;
}

export const INLINE_STATUS_PRESENTATION: Record<
  InlineStatusVariant,
  { icon: string; className: string }
> = {
  warning: { icon: 'alert-triangle', className: 'local-dictation-status--warning' },
  info: { icon: 'info', className: 'local-dictation-status--info' },
};

export function deriveInlineStatus(args: {
  health: ProviderHealth;
  models: ReadonlyArray<ModelOption>;
  providerId: LlmProviderId;
  selectedModel: string;
}): InlineStatus | null {
  const providerName = formatLlmProviderName(args.providerId);

  switch (args.health.kind) {
    case 'unknown':
      if (args.selectedModel === '') {
        return { text: selectModelMessage(args.providerId), variant: 'info' };
      }
      return null;
    case 'unreachable':
      return {
        text:
          args.providerId === 'ollama'
            ? t('llm.status.ollamaNotRunning')
            : args.providerId === 'openai_compatible'
              ? t('llm.status.customModelsUnavailable')
              : t('llm.status.unreachable', { provider: providerName }),
        variant: 'warning',
      };
    case 'auth_invalid':
      return { text: t('llm.status.authInvalid', { provider: providerName }), variant: 'warning' };
    case 'permission_denied':
      return {
        text: t('llm.status.permissionDenied', { provider: providerName }),
        variant: 'warning',
      };
    case 'rate_limited':
      return { text: t('llm.status.rateLimited', { provider: providerName }), variant: 'warning' };
    case 'no_models':
      return {
        text:
          args.providerId === 'ollama'
            ? t('llm.status.noOllamaModels')
            : t('llm.status.noModels', { provider: providerName }),
        variant: 'warning',
      };
    case 'ready':
      if (args.selectedModel === '') {
        return { text: selectModelMessage(args.providerId), variant: 'info' };
      }
      if (args.models.length > 0 && !args.models.some((model) => model.id === args.selectedModel)) {
        return { text: t('llm.status.selectedUnavailable'), variant: 'warning' };
      }
      return null;
  }
}

function selectModelMessage(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'ollama':
      return t('llm.status.selectOllamaModel');
    case 'openrouter':
      return t('llm.status.selectOpenRouterModel');
    case 'openai_compatible':
      return t('llm.status.selectCustomModel');
  }
}
