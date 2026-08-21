import { t } from '../shared/i18n';
import type { TranslationEngineId } from './languages';

export interface TranslationEngineDefinition {
  familyId: 'firefox_translations' | 'tencent_hy_mt';
  id: TranslationEngineId;
  label: () => string;
  runtimeId: 'bergamot_wasm' | 'llama_cpp';
}

export const TRANSLATION_ENGINES: readonly TranslationEngineDefinition[] = [
  {
    familyId: 'firefox_translations',
    id: 'bergamot',
    label: () => t('translation.engine.bergamot'),
    runtimeId: 'bergamot_wasm',
  },
  {
    familyId: 'tencent_hy_mt',
    id: 'tencent_hy_mt',
    label: () => t('translation.engine.tencentHyMt'),
    runtimeId: 'llama_cpp',
  },
];

export function translationEngineLabel(engineId: TranslationEngineId): string {
  return TRANSLATION_ENGINES.find((engine) => engine.id === engineId)?.label() ?? engineId;
}
