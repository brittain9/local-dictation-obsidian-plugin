import { basename } from 'node:path';

import {
  checkAbsoluteExistingFilePath,
  type ExistingFilePathValidationCode,
} from '../filesystem/path-validation';
import { t } from '../shared/i18n';
import type { ExternalFileModelSelection } from './model-management-types';

export interface ExternalFileEngineOption {
  entryFilename?: string;
  entryFilenameErrorKey?:
    | 'models.external.validation.nemotronEntryFile'
    | 'models.external.validation.moonshineEntryFile';
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
    entryFilenameErrorKey: 'models.external.validation.nemotronEntryFile',
    label: 'NVIDIA Nemotron 3.5 ASR (ONNX Runtime)',
    placeholder: '/absolute/path/to/nemotron/encoder.int8.onnx',
    requirements: [
      t('models.external.requirements.nemotron.entry'),
      t('models.external.requirements.nemotron.siblings'),
      t('models.external.requirements.nemotron.compatibility'),
    ],
    selection: { familyId: 'nemotron_asr', runtimeId: 'onnx_runtime' },
  },
  {
    entryFilename: 'frontend.ort',
    entryFilenameErrorKey: 'models.external.validation.moonshineEntryFile',
    label: 'Moonshine (ONNX Runtime)',
    placeholder: '/absolute/path/to/moonshine/frontend.ort',
    requirements: [
      t('models.external.requirements.moonshine.entry'),
      t('models.external.requirements.moonshine.siblings'),
      t('models.external.requirements.moonshine.compatibility'),
    ],
    selection: { familyId: 'moonshine', runtimeId: 'onnx_runtime' },
  },
  {
    label: 'Whisper (whisper.cpp)',
    placeholder: '/absolute/path/to/ggml-small.en-q5_1.bin',
    requirements: [
      t('models.external.requirements.whisper.entry'),
      t('models.external.requirements.whisper.validation'),
      t('models.external.requirements.whisper.language'),
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
  const pathResult = await checkAbsoluteExistingFilePath(filePath);
  if (!pathResult.valid) {
    throw new ExternalModelFileValidationError(pathResult.code, pathResult.path);
  }
  const normalizedPath = pathResult.path;

  const option = getExternalFileEngineOption(engine);
  if (option?.entryFilename && basename(normalizedPath) !== option.entryFilename) {
    throw new ExternalModelFileValidationError(
      'wrong_entry_file',
      option.entryFilename,
      option.entryFilenameErrorKey,
    );
  }

  return normalizedPath;
}

export function formatExternalModelValidationError(error: unknown): string {
  if (error instanceof ExternalModelFileValidationError) {
    return error.message;
  }

  return t('models.external.validation.generic');
}

type ExternalModelFileValidationCode = ExistingFilePathValidationCode | 'wrong_entry_file';

class ExternalModelFileValidationError extends Error {
  constructor(
    readonly code: ExternalModelFileValidationCode,
    readonly detail?: string,
    readonly messageKey?: ExternalFileEngineOption['entryFilenameErrorKey'],
  ) {
    super(formatTypedValidationError(code, detail, messageKey));
    this.name = 'ExternalModelFileValidationError';
  }
}

function formatTypedValidationError(
  code: ExternalModelFileValidationCode,
  detail?: string,
  messageKey?: ExternalFileEngineOption['entryFilenameErrorKey'],
): string {
  switch (code) {
    case 'not_configured':
      return t('models.external.validation.notConfigured');
    case 'not_absolute':
      return t('models.external.validation.notAbsolute');
    case 'missing':
      return t('models.external.validation.missing', { path: detail ?? '' });
    case 'not_file':
      return t('models.external.validation.notFile', { path: detail ?? '' });
    case 'wrong_entry_file':
      return messageKey !== undefined
        ? t(messageKey)
        : t('models.external.validation.selectEntryFile', { filename: detail ?? '' });
  }
}
