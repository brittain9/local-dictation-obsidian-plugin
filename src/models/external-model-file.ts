import { basename } from 'node:path';

import { assertAbsoluteExistingFilePath } from '../filesystem/path-validation';
import type { ExternalFileModelSelection } from './model-management-types';

export interface ExternalFileEngineOption {
  entryFilename?: string;
  entryFilenameError?: string;
  label: string;
  placeholder: string;
  requirements: string[];
  selection: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;
}

export const DEFAULT_EXTERNAL_FILE_ENGINE_SELECTION = {
  familyId: 'whisper',
  runtimeId: 'whisper_cpp',
} as const satisfies Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'>;

export const EXTERNAL_FILE_ENGINES: readonly ExternalFileEngineOption[] = [
  {
    entryFilename: 'encoder.int8.onnx',
    entryFilenameError:
      'Nemotron 3.5 ASR requires its encoder.int8.onnx artifact. Select encoder.int8.onnx from the pinned 560 ms model directory.',
    label: 'NVIDIA Nemotron 3.5 ASR (ONNX Runtime)',
    placeholder: '/absolute/path/to/nemotron/encoder.int8.onnx',
    requirements: [
      'Select encoder.int8.onnx from the pinned Nemotron 3.5 ASR 560 ms int8 export.',
      'The same directory must contain decoder.int8.onnx, joiner.int8.onnx, and tokens.txt.',
      'Other chunk sizes and ORT GenAI exports are not compatible with this adapter.',
    ],
    selection: { familyId: 'nemotron_asr', runtimeId: 'onnx_runtime' },
  },
  {
    entryFilename: 'frontend.ort',
    entryFilenameError:
      'Moonshine requires its primary frontend.ort artifact. Select frontend.ort from the streaming model directory.',
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
      'Whisper files with .en weights are English-only; multilingual weights expose the verified language selector and automatic detection.',
    ],
    selection: DEFAULT_EXTERNAL_FILE_ENGINE_SELECTION,
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

  const option = getExternalFileEngineOption(engine);
  if (option?.entryFilename && basename(normalizedPath) !== option.entryFilename) {
    throw new Error(option.entryFilenameError ?? `Select ${option.entryFilename}.`);
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
