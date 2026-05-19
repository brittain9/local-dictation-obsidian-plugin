import type { OllamaModelOption } from '../llm/ollama-client';

export type OllamaHealth =
  | { kind: 'unknown' }
  | { kind: 'unreachable' }
  | { kind: 'no_models' }
  | { kind: 'ready'; modelCount: number };

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

export function formatOllamaHealth(health: OllamaHealth): string {
  switch (health.kind) {
    case 'unknown':
      return 'Status unknown.';
    case 'unreachable':
      return 'Not running.';
    case 'no_models':
      return 'Running, but no chat models installed.';
    case 'ready':
      return `Ready (${health.modelCount} chat model${health.modelCount === 1 ? '' : 's'}).`;
  }
}

export function deriveInlineStatus(args: {
  health: OllamaHealth;
  models: ReadonlyArray<OllamaModelOption>;
  selectedModel: string;
}): InlineStatus | null {
  switch (args.health.kind) {
    case 'unknown':
      return null;
    case 'unreachable':
      return { text: 'Ollama is not running.', variant: 'warning' };
    case 'no_models':
      return { text: 'No chat models installed in Ollama.', variant: 'warning' };
    case 'ready':
      if (args.selectedModel === '') {
        return { text: 'Select an Ollama model below.', variant: 'info' };
      }
      if (!args.models.some((model) => model.id === args.selectedModel)) {
        return { text: 'Selected model is unavailable.', variant: 'warning' };
      }
      return null;
  }
}
