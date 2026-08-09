import type { App, TFile } from 'obsidian';

const MAX_CREATE_COLLISION_RETRIES = 10;
const MAX_FILENAME_BYTES = 240;
const INVALID_FILENAME_CHARACTERS = new Set(['"', '*', '/', ':', '<', '>', '?', '\\', '|']);

export interface TranslationSourceNote {
  basename: string;
  parentPath: string;
}

export interface CreatedTranslationNote {
  file: TFile;
  openError?: unknown;
}

export function findAvailableTranslationNotePath(
  sourceNote: TranslationSourceNote,
  targetLanguageLabel: string,
  occupiedPaths: Iterable<string>,
): string {
  const occupied = new Set(Array.from(occupiedPaths, vaultPathKey));
  const basename = safeFilenameComponent(sourceNote.basename, 'Note');
  const language = safeFilenameComponent(targetLanguageLabel, 'Translation');

  for (let index = 1; ; index += 1) {
    const collisionSuffix = index === 1 ? '' : ` ${index}`;
    const filenameSuffix = ` (${language})${collisionSuffix}.md`;
    const availableBasenameBytes = Math.max(1, MAX_FILENAME_BYTES - utf8ByteLength(filenameSuffix));
    const boundedBasename = trimFilenameEnd(truncateToUtf8Bytes(basename, availableBasenameBytes));
    const filename = `${boundedBasename || 'Note'}${filenameSuffix}`;
    const path = sourceNote.parentPath === '' ? filename : `${sourceNote.parentPath}/${filename}`;
    if (!occupied.has(vaultPathKey(path))) return path;
  }
}

export async function createTranslationSiblingNote(
  app: Pick<App, 'vault' | 'workspace'>,
  sourceNote: TranslationSourceNote,
  targetLanguageLabel: string,
  contents: string,
): Promise<CreatedTranslationNote> {
  let collisionRetries = 0;
  let file: TFile;

  for (;;) {
    const path = findAvailableTranslationNotePath(
      sourceNote,
      targetLanguageLabel,
      app.vault.getAllLoadedFiles().map((entry) => entry.path),
    );
    try {
      // Vault.create rejects when a file already exists; unlike modify/process,
      // it has no overwrite path.
      file = await app.vault.create(path, contents);
      break;
    } catch (error) {
      const collisionAppeared =
        app.vault.getAbstractFileByPath(path) !== null ||
        app.vault
          .getAllLoadedFiles()
          .some((entry) => vaultPathKey(entry.path) === vaultPathKey(path));
      if (!collisionAppeared || collisionRetries >= MAX_CREATE_COLLISION_RETRIES) throw error;
      collisionRetries += 1;
    }
  }

  try {
    await app.workspace.getLeaf('tab').openFile(file);
    return { file };
  } catch (openError) {
    // Creation already succeeded, so report that state instead of retrying and
    // producing a duplicate translated note.
    return { file, openError };
  }
}

function safeFilenameComponent(value: string, fallback: string): string {
  let safe = '';
  let replacingInvalidRun = false;
  for (const character of value.normalize('NFC').trim()) {
    const codePoint = character.codePointAt(0) ?? 0;
    const invalid =
      INVALID_FILENAME_CHARACTERS.has(character) || codePoint <= 31 || codePoint === 127;
    if (invalid) {
      if (!replacingInvalidRun) safe += '-';
      replacingInvalidRun = true;
    } else {
      safe += character;
      replacingInvalidRun = false;
    }
  }
  return trimFilenameEnd(safe) || fallback;
}

function trimFilenameEnd(value: string): string {
  return value.replace(/[ .]+$/u, '');
}

function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  let result = '';
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (usedBytes + characterBytes > maxBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function vaultPathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
