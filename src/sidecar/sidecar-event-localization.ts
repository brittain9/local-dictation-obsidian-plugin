import { type TranslationKey, t } from '../shared/i18n';
import type { ErrorEvent, WarningEvent } from './protocol';

export const SIDECAR_EVENT_TRANSLATION_KEYS = {
  audio_too_long: 'sidecarError.audio_too_long',
  engine_inference_failed: 'sidecarError.engine_inference_failed',
  helper_protocol_error: 'sidecarError.helper_protocol_error',
  helper_unavailable: 'sidecarError.helper_unavailable',
  helper_write_failed: 'sidecarError.helper_write_failed',
  inference_failed: 'sidecarError.inference_failed',
  model_load_failed: 'sidecarError.model_load_failed',
  internal_error: 'sidecarError.internal_error',
  invalid_audio_buffer: 'sidecarError.invalid_audio_buffer',
  invalid_audio_frame: 'sidecarError.invalid_audio_frame',
  invalid_diarization_speaker_limit: 'sidecarError.invalid_diarization_speaker_limit',
  invalid_frame: 'sidecarError.invalid_frame',
  invalid_model_file: 'sidecarError.invalid_model_file',
  invalid_model_task: 'sidecarError.invalid_model_task',
  invalid_model_store: 'sidecarError.invalid_model_store',
  invalid_synthesis_request: 'sidecarError.invalid_synthesis_request',
  invalid_translation_request: 'sidecarError.invalid_translation_request',
  missing_model_file: 'sidecarError.missing_model_file',
  missing_voice_file: 'sidecarError.missing_voice_file',
  no_active_install: 'sidecarError.no_active_install',
  no_active_session: 'sidecarError.no_active_session',
  session_already_exists: 'sidecarError.session_already_exists',
  session_capacity_exceeded: 'sidecarError.session_capacity_exceeded',
  sidecar_exited: 'sidecarError.sidecar_exited',
  system_audio_capture_failed: 'sidecarError.system_audio_capture_failed',
  system_audio_permission_denied: 'sidecarError.system_audio_permission_denied',
  system_audio_unsupported: 'sidecarError.system_audio_unsupported',
  synthesis_cancelled: 'sidecarError.synthesis_cancelled',
  synthesis_failed: 'sidecarError.synthesis_failed',
  synthesis_worker_unavailable: 'sidecarError.synthesis_worker_unavailable',
  transcription_failure: 'sidecarError.transcription_failure',
  translation_busy: 'sidecarError.translation_busy',
  translation_worker_unavailable: 'sidecarError.translation_worker_unavailable',
  unsupported_engine: 'sidecarError.unsupported_engine',
  unsupported_language: 'sidecarError.unsupported_language',
  utterance_dropped_during_overload_drain: 'sidecarError.utterance_dropped_during_overload_drain',
  utterance_queue_overload: 'sidecarError.utterance_queue_overload',
  vad_error: 'sidecarError.vad_error',
  vad_init_failed: 'sidecarError.vad_init_failed',
  worker_panic: 'sidecarError.worker_panic',
} as const satisfies Record<string, TranslationKey>;

export type NativeEventCode = keyof typeof SIDECAR_EVENT_TRANSLATION_KEYS;

export const KNOWN_NATIVE_EVENT_CODES = Object.keys(
  SIDECAR_EVENT_TRANSLATION_KEYS,
) as NativeEventCode[];

export function localizeKnownSidecarEventCode(code: string | undefined): string | null {
  const key = SIDECAR_EVENT_TRANSLATION_KEYS[code as NativeEventCode];
  return key === undefined ? null : t(key);
}

export function localizeSidecarEvent(event: ErrorEvent | WarningEvent): string {
  return localizeKnownSidecarEventCode(event.code) ?? rawSidecarEventDetail(event);
}

export function rawSidecarEventDetail(event: ErrorEvent | WarningEvent): string {
  return event.details ? `${event.message} (${event.details})` : event.message;
}
