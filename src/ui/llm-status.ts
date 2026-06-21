import {
  formatLlmProviderName,
  type LlmProviderId,
  type ModelOption,
  type ProviderHealth,
} from '../llm/provider';

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
        return { text: `Select ${providerArticle(providerName)} model below.`, variant: 'info' };
      }
      return null;
    case 'unreachable':
      return {
        text:
          args.providerId === 'ollama'
            ? 'Ollama is not running.'
            : `${providerName} is unreachable.`,
        variant: 'warning',
      };
    case 'auth_invalid':
      return { text: `${providerName} API key rejected.`, variant: 'warning' };
    case 'rate_limited':
      return { text: `${providerName} rate limit hit.`, variant: 'warning' };
    case 'no_models':
      return {
        text:
          args.providerId === 'ollama'
            ? 'No chat models installed in Ollama.'
            : `No usable ${providerName} models found.`,
        variant: 'warning',
      };
    case 'ready':
      if (args.selectedModel === '') {
        return { text: `Select ${providerArticle(providerName)} model below.`, variant: 'info' };
      }
      if (args.models.length > 0 && !args.models.some((model) => model.id === args.selectedModel)) {
        return { text: 'Selected model is unavailable.', variant: 'warning' };
      }
      return null;
  }
}

function providerArticle(providerName: string): string {
  return /^[AEIOU]/u.test(providerName) ? `an ${providerName}` : `a ${providerName}`;
}
