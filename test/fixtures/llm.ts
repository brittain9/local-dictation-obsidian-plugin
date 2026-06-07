import { vi } from 'vitest';

import type { LlmProvider, LlmProviderId } from '../../src/llm/provider';
import type {
  LlmRouter,
  LlmRouterCleanupOptions,
  LlmRouterCleanupResult,
} from '../../src/llm/router';

export function createFakeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    cleanup: vi.fn(async () => 'clean text'),
    id: 'ollama',
    listModels: vi.fn(async () => []),
    probe: vi.fn(async () => ({ kind: 'unknown' as const })),
    ...overrides,
  };
}

interface FakeRouterOptions {
  cleanup?: (options: LlmRouterCleanupOptions) => Promise<LlmRouterCleanupResult>;
  model?: string;
  providerId?: LlmProviderId;
}

// Default fake router: echoes a fixed cleaned text and reports the chosen
// provider/model so controller tests can assert routing telemetry without a
// real provider. Pass `cleanup` to drive failures or custom output.
export function createFakeLlmRouter(options: FakeRouterOptions = {}): LlmRouter {
  const providerId = options.providerId ?? 'ollama';
  const model = options.model ?? 'fake-model';
  return {
    cleanup:
      options.cleanup ??
      vi.fn(async (cleanupOptions: LlmRouterCleanupOptions) => ({
        model,
        providerId,
        text: `clean: ${cleanupOptions.userMessage}`,
      })),
  };
}
