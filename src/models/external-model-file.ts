import { basename } from 'node:path';

import { assertAbsoluteExistingFilePath } from '../filesystem/path-validation';
import type { ExternalFileModelSelection } from './model-management-types';

export interface ExternalFileEngineOption {
  label: string;
  placeholder: string;
  requirements: string[];
  selection: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;
}

export const EXTERNAL_FILE_ENGINES: readonly ExternalFileEngineOption[] = [
  {
    label: 'Moonshine (ONNX Runtime)',
    placeholder: '/absolute/path/to/moonshine/frontend.ort',
    requirements: [
      'Select frontend.ort from a Moonshine v2 streaming ORT model directory.',
      'The same directory must contain encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json, and tokenizer.bin.',
      'Non-streaming Moonshine ONNX exports are not compatible.',
    ],
    selection: { familyId: 'moonshine', runtimeId: 'onnx_runtime' },
  },
  {
    label: 'Whisper (whisper.cpp)',
    placeholder: '/absolute/path/to/ggml-small.en-q5_1.bin',
    requirements: [
      'Select one whisper.cpp-compatible GGML or GGUF model file.',
      'The loader validates the file contents; a filename extension alone does not establish compatibility.',
      'Local Dictation currently runs Whisper models in English.',
    ],
    selection: { familyId: 'whisper', runtimeId: 'whisper_cpp' },
  },
];

export function getExternalFileEngineOption(
  selection: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>,
): ExternalFileEngineOption | null {
  return (
    EXTERNAL_FILE_ENGINES.find(
      (candidate) =>
        candidate.selection.runtimeId === selection.runtimeId &&
        candidate.selection.familyId === selection.familyId,
    ) ?? null
  );
}

export async function validateExternalModelFilePath(
  filePath: string,
  engine: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>,
): Promise<string> {
  const normalizedPath = await assertAbsoluteExistingFilePath(filePath, 'Model file path');

  if (engine.familyId === 'moonshine' && basename(normalizedPath) !== 'frontend.ort') {
    throw new Error(
      'Moonshine requires its primary frontend.ort artifact. Select frontend.ort from the streaming model directory.',
    );
  }

  return normalizedPath;
}

export function formatExternalModelValidationError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }

  return 'The speech engine could not validate this model.';
}
