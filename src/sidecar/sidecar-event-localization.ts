import { type TranslationKey, t } from '../shared/i18n';
import type { ErrorEvent, WarningEvent } from './protocol';

export const KNOWN_NATIVE_EVENT_CODES = [
  'audio_too_long',
  'engine_inference_failed',
  'internal_error',
  'invalid_audio_buffer',
  'invalid_audio_frame',
  'invalid_diarization_speaker_limit',
  'invalid_frame',
  'invalid_model_file',
  'invalid_model_store',
  'missing_model_file',
  'no_active_install',
  'no_active_session',
  'session_already_exists',
  'session_capacity_exceeded',
  'system_audio_capture_failed',
  'system_audio_permission_denied',
  'system_audio_unsupported',
  'transcription_failure',
  'unsupported_engine',
  'unsupported_language',
  'utterance_dropped_during_overload_drain',
  'utterance_queue_overload',
  'vad_error',
  'vad_init_failed',
  'worker_panic',
] as const;

export type NativeEventCode = (typeof KNOWN_NATIVE_EVENT_CODES)[number];

export const SIDECAR_EVENT_TRANSLATION_KEYS = {
  audio_too_long: 'sidecarError.audio_too_long',
  engine_inference_failed: 'sidecarError.engine_inference_failed',
  internal_error: 'sidecarError.internal_error',
  invalid_audio_buffer: 'sidecarError.invalid_audio_buffer',
  invalid_audio_frame: 'sidecarError.invalid_audio_frame',
  invalid_diarization_speaker_limit: 'sidecarError.invalid_diarization_speaker_limit',
  invalid_frame: 'sidecarError.invalid_frame',
  invalid_model_file: 'sidecarError.invalid_model_file',
  invalid_model_store: 'sidecarError.invalid_model_store',
  missing_model_file: 'sidecarError.missing_model_file',
  no_active_install: 'sidecarError.no_active_install',
  no_active_session: 'sidecarError.no_active_session',
  session_already_exists: 'sidecarError.session_already_exists',
  session_capacity_exceeded: 'sidecarError.session_capacity_exceeded',
  system_audio_capture_failed: 'sidecarError.system_audio_capture_failed',
  system_audio_permission_denied: 'sidecarError.system_audio_permission_denied',
  system_audio_unsupported: 'sidecarError.system_audio_unsupported',
  transcription_failure: 'sidecarError.transcription_failure',
  unsupported_engine: 'sidecarError.unsupported_engine',
  unsupported_language: 'sidecarError.unsupported_language',
  utterance_dropped_during_overload_drain: 'sidecarError.utterance_dropped_during_overload_drain',
  utterance_queue_overload: 'sidecarError.utterance_queue_overload',
  vad_error: 'sidecarError.vad_error',
  vad_init_failed: 'sidecarError.vad_init_failed',
  worker_panic: 'sidecarError.worker_panic',
} as const satisfies Record<NativeEventCode, TranslationKey>;

export function localizeSidecarEvent(event: ErrorEvent | WarningEvent): string {
  const key = SIDECAR_EVENT_TRANSLATION_KEYS[event.code as NativeEventCode];
  return key === undefined ? rawSidecarEventDetail(event) : t(key);
}

export function rawSidecarEventDetail(event: ErrorEvent | WarningEvent): string {
  return event.details ? `${event.message} (${event.details})` : event.message;
}
