import { describe, expect, it } from 'vitest';

import type { OllamaModelOption } from '../src/llm/ollama-client';
import { deriveInlineStatus, formatOllamaHealth } from '../src/ui/llm-status';

const models = (...ids: string[]): OllamaModelOption[] =>
  ids.map((id) => ({ displayName: id, id }));

describe('formatOllamaHealth', () => {
  it('formats each health kind', () => {
    expect(formatOllamaHealth({ kind: 'unknown' })).toBe('Status unknown.');
    expect(formatOllamaHealth({ kind: 'unreachable' })).toBe('Not running.');
    expect(formatOllamaHealth({ kind: 'no_models' })).toBe(
      'Running, but no chat models installed.',
    );
    expect(formatOllamaHealth({ kind: 'ready', modelCount: 1 })).toBe('Ready (1 chat model).');
    expect(formatOllamaHealth({ kind: 'ready', modelCount: 3 })).toBe('Ready (3 chat models).');
  });
});

describe('deriveInlineStatus', () => {
  it('returns null while health is unknown to avoid premature warnings on first probe', () => {
    expect(
      deriveInlineStatus({ health: { kind: 'unknown' }, models: [], selectedModel: '' }),
    ).toBeNull();
  });

  it('surfaces unreachable Ollama as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'unreachable' },
        models: [],
        selectedModel: 'llama3.2',
      }),
    ).toEqual({ text: 'Ollama is not running.', variant: 'warning' });
  });

  it('surfaces empty model installation as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'no_models' },
        models: [],
        selectedModel: '',
      }),
    ).toEqual({ text: 'No chat models installed in Ollama.', variant: 'warning' });
  });

  it('asks the user to select a model as an info hint, not a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 2 },
        models: models('llama3.2', 'qwen2.5'),
        selectedModel: '',
      }),
    ).toEqual({ text: 'Select an Ollama model below.', variant: 'info' });
  });

  it('flags a selected model that is no longer in the list as a warning', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 1 },
        models: models('llama3.2'),
        selectedModel: 'qwen2.5',
      }),
    ).toEqual({ text: 'Selected model is unavailable.', variant: 'warning' });
  });

  it('returns null when ready, a model is selected, and it is available', () => {
    expect(
      deriveInlineStatus({
        health: { kind: 'ready', modelCount: 1 },
        models: models('llama3.2'),
        selectedModel: 'llama3.2',
      }),
    ).toBeNull();
  });
});
