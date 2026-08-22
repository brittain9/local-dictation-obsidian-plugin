import { describe, expect, it } from 'vitest';

import { resolveInstalledTranslationEngine } from '../src/translation/translation-engines';

const firefox = {
  familyId: 'firefox_translations',
  modelId: 'firefox',
  runtimeId: 'bergamot_wasm',
  task: 'translation',
  translationSupport: {
    kind: 'pairs',
    pairs: [
      { source: 'en', target: 'es' },
      { source: 'es', target: 'en' },
    ],
  },
} as const;

const tencent = {
  familyId: 'tencent_hy_mt',
  modelId: 'hy-mt',
  runtimeId: 'llama_cpp',
  task: 'translation',
  translationSupport: { kind: 'all_to_all', languages: ['en', 'es', 'fr'] },
} as const;

const installedFirefox = {
  familyId: firefox.familyId,
  modelId: firefox.modelId,
  runtimeId: firefox.runtimeId,
};

const installedTencent = {
  familyId: tencent.familyId,
  modelId: tencent.modelId,
  runtimeId: tencent.runtimeId,
};

function state(installedModels: readonly object[]) {
  return {
    catalog: { models: [firefox, tencent] },
    installedModels,
  } as never;
}

describe('installed translation engine resolution', () => {
  it('keeps a compatible installed preference', () => {
    expect(
      resolveInstalledTranslationEngine(
        state([installedFirefox, installedTencent]),
        'bergamot',
        'en',
        'es',
      ),
    ).toEqual({ availability: 'available', engineId: 'bergamot', status: 'preferred' });
  });

  it('falls back to the only compatible installed engine', () => {
    expect(
      resolveInstalledTranslationEngine(state([installedTencent]), 'bergamot', 'en', 'es'),
    ).toEqual({
      availability: 'available',
      engineId: 'tencent_hy_mt',
      status: 'installed_fallback',
    });
  });

  it('keeps the product default as the missing target when nothing is installed', () => {
    expect(resolveInstalledTranslationEngine(state([]), 'bergamot', 'en', 'es')).toEqual({
      availability: 'not_installed',
      engineId: 'bergamot',
      status: 'missing_model',
    });
  });

  it('uses Natural for a pair unsupported by Fast', () => {
    expect(
      resolveInstalledTranslationEngine(
        state([installedFirefox, installedTencent]),
        'bergamot',
        'fr',
        'es',
      ),
    ).toEqual({
      availability: 'available',
      engineId: 'tencent_hy_mt',
      status: 'installed_fallback',
    });
  });

  it('falls back after the preferred model is removed', () => {
    expect(
      resolveInstalledTranslationEngine(state([installedFirefox]), 'tencent_hy_mt', 'en', 'es'),
    ).toEqual({
      availability: 'available',
      engineId: 'bergamot',
      status: 'installed_fallback',
    });
  });
});
