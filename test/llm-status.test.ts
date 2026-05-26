import { describe, expect, it } from 'vitest';

import type { ModelOption } from '../src/llm/provider';
import { deriveInlineStatus, formatProviderHealth } from '../src/ui/llm-status';

const models = (...ids: string[]): ModelOption[] => ids.map((id) => ({ displayName: id, id }));

describe('formatProviderHealth', () => {
  it('formats each health kind', () => {
    expect(formatProviderHealth({ kind: 'unknown' }, 'ollama')).toBe('Status unknown.');
    expect(formatProviderHealth({ kind: 'unreachable' }, 'ollama')).toBe('Not running.');
    expect(formatProviderHealth({ kind: 'auth_invalid' }, 'gemini')).toBe('API key rejected.');
    expect(formatProviderHealth({ kind: 'rate_limited' }, 'openrouter')).toBe('Rate limit hit.');
    expect(formatProviderHealth({ kind: 'no_models' }, 'ollama')).toBe(
      'Running, but no chat models installed.',
    );
    expect(formatProviderHealth({ kind: 'ready', modelCount: 1 }, 'ollama')).toBe(
      'Ready (1 model).',
    );
    expect(formatProviderHealth({ kind: 'ready', modelCount: 3 }, 'ollama')).toBe(
      'Ready (3 models).',
    );
  });
});

describe('deriveInlineStatus', () => {
  it('asks for a model while health is unknown and no model is selected', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'unknown' },
        models: [],
        providerId: 'openrouter',
        selectedModel: '',
      }),
    ).toEqual({ text: 'Select an OpenRouter model below.', variant: 'info' });
  });

  it('surfaces unreachable Ollama as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'unreachable' },
        models: [],
        providerId: 'ollama',
        selectedModel: 'llama3.2',
      }),
    ).toEqual({ text: 'Ollama is not running.', variant: 'warning' });
  });

  it('surfaces empty model installation as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'no_models' },
        models: [],
        providerId: 'ollama',
        selectedModel: '',
      }),
    ).toEqual({ text: 'No chat models installed in Ollama.', variant: 'warning' });
  });

  it('asks the user to select a model as an info hint, not a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 2 },
        models: models('llama3.2', 'qwen2.5'),
        providerId: 'ollama',
        selectedModel: '',
      }),
    ).toEqual({ text: 'Select an Ollama model below.', variant: 'info' });
  });

  it('flags a selected model that is no longer in the list as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 1 },
        models: models('llama3.2'),
        providerId: 'ollama',
        selectedModel: 'qwen2.5',
      }),
    ).toEqual({ text: 'Selected model is unavailable.', variant: 'warning' });
  });

  it('returns null when ready, a model is selected, and it is available', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 1 },
        models: models('llama3.2'),
        providerId: 'ollama',
        selectedModel: 'llama3.2',
      }),
    ).toBeNull();
  });
});
