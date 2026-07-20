import { t } from '../shared/i18n';

const MODEL_SUMMARY_KEYS = {
  cohere_transcribe_fp16: 'catalog.cohere_transcribe_fp16.summary',
  cohere_transcribe_int8: 'catalog.cohere_transcribe_int8.summary',
  cohere_transcribe_q4: 'catalog.cohere_transcribe_q4.summary',
  moonshine_medium_streaming_en: 'catalog.moonshine_medium_streaming_en.summary',
  moonshine_small_streaming_en: 'catalog.moonshine_small_streaming_en.summary',
  moonshine_tiny_streaming_en: 'catalog.moonshine_tiny_streaming_en.summary',
  nemotron_asr_0_6b_int8_streaming_560ms: 'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary',
  pocket_tts_english_2026_04_int8: 'catalog.pocket_tts_english_2026_04_int8.summary',
  pocket_tts_french_24l_int8: 'catalog.pocket_tts_french_24l_int8.summary',
  pocket_tts_german_int8: 'catalog.pocket_tts_german_int8.summary',
  pocket_tts_spanish_int8: 'catalog.pocket_tts_spanish_int8.summary',
  pocket_tts_portuguese_int8: 'catalog.pocket_tts_portuguese_int8.summary',
  pocket_tts_italian_int8: 'catalog.pocket_tts_italian_int8.summary',
  whisper_base_en_q8_0: 'catalog.whisper_base_en_q8_0.summary',
  whisper_large_v3_turbo_q8_0: 'catalog.whisper_large_v3_turbo_q8_0.summary',
  whisper_medium_en_q5_0: 'catalog.whisper_medium_en_q5_0.summary',
  whisper_small_en_q5_1: 'catalog.whisper_small_en_q5_1.summary',
  whisper_tiny_en_q8_0: 'catalog.whisper_tiny_en_q8_0.summary',
} as const;

const FAMILY_SUMMARY_KEYS = {
  cohere_transcribe: 'catalog.family.cohere_transcribe.summary',
  moonshine: 'catalog.family.moonshine.summary',
  nemotron_asr: 'catalog.family.nemotron_asr.summary',
  pocket_tts: 'catalog.family.pocket_tts.summary',
  whisper: 'catalog.family.whisper.summary',
} as const;

export function localizeModelSummary(modelId: string, fallback: string): string {
  const key = MODEL_SUMMARY_KEYS[modelId as keyof typeof MODEL_SUMMARY_KEYS];
  return key === undefined ? fallback : t(key);
}

export function localizeFamilySummary(familyId: string, fallback: string): string {
  const key = FAMILY_SUMMARY_KEYS[familyId as keyof typeof FAMILY_SUMMARY_KEYS];
  return key === undefined ? fallback : t(key);
}
