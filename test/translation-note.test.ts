import { describe, expect, it, vi } from 'vitest';

import {
  createTranslationSiblingNote,
  findAvailableTranslationNotePath,
} from '../src/translation/translation-note';

describe('findAvailableTranslationNotePath', () => {
  it('uses the target language autonym and the source note folder', () => {
    expect(
      findAvailableTranslationNotePath(
        { basename: 'Meeting notes', parentPath: 'Work/Meetings' },
        '日本語',
        [],
      ),
    ).toBe('Work/Meetings/Meeting notes (日本語).md');
  });

  it('increments deterministic suffixes without reusing a case-variant path', () => {
    expect(
      findAvailableTranslationNotePath({ basename: 'Roadmap', parentPath: 'Projects' }, 'Español', [
        'Projects/Roadmap (Español).md',
        'projects/roadmap (español) 2.md',
      ]),
    ).toBe('Projects/Roadmap (Español) 3.md');
  });

  it('sanitizes cross-platform filename characters and bounds UTF-8 length', () => {
    const path = findAvailableTranslationNotePath(
      { basename: `${'🌍'.repeat(100)}: Q3?`, parentPath: '' },
      'Français',
      [],
    );

    expect(path).not.toMatch(/[:?]/u);
    expect(new TextEncoder().encode(path).byteLength).toBeLessThanOrEqual(240);
    expect(path).toMatch(/ \(Français\)\.md$/u);
  });
});

describe('createTranslationSiblingNote', () => {
  it('retries a creation-time collision, never modifies a note, and opens a new tab', async () => {
    const files = [{ path: 'Folder/Source (Español).md' }];
    const createdFile = {
      basename: 'Source (Español) 3',
      name: 'Source (Español) 3.md',
      path: 'Folder/Source (Español) 3.md',
    };
    const create = vi
      .fn()
      .mockImplementationOnce(async () => {
        files.push({ path: 'Folder/Source (Español) 2.md' });
        throw new Error('File already exists');
      })
      .mockResolvedValueOnce(createdFile);
    const openFile = vi.fn(async () => {});
    const getLeaf = vi.fn(() => ({ openFile }));
    const app = {
      vault: {
        create,
        getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        getAllLoadedFiles: () => files,
      },
      workspace: { getLeaf },
    };

    const result = await createTranslationSiblingNote(
      app as never,
      { basename: 'Source', parentPath: 'Folder' },
      'Español',
      '# Traducción',
    );

    expect(create).toHaveBeenNthCalledWith(1, 'Folder/Source (Español) 2.md', '# Traducción');
    expect(create).toHaveBeenNthCalledWith(2, 'Folder/Source (Español) 3.md', '# Traducción');
    expect(getLeaf).toHaveBeenCalledExactlyOnceWith('tab');
    expect(openFile).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(result).toEqual({ file: createdFile });
  });

  it('returns the created file when opening it fails instead of creating a duplicate', async () => {
    const openError = new Error('No leaf available');
    const createdFile = {
      basename: 'Source (Deutsch)',
      name: 'Source (Deutsch).md',
      path: 'Source (Deutsch).md',
    };
    const create = vi.fn(async () => createdFile);
    const app = {
      vault: {
        create,
        getAbstractFileByPath: () => null,
        getAllLoadedFiles: () => [],
      },
      workspace: {
        getLeaf: () => ({
          openFile: vi.fn(async () => {
            throw openError;
          }),
        }),
      },
    };

    await expect(
      createTranslationSiblingNote(
        app as never,
        { basename: 'Source', parentPath: '' },
        'Deutsch',
        'Übersetzung',
      ),
    ).resolves.toEqual({ file: createdFile, openError });
    expect(create).toHaveBeenCalledOnce();
  });
});
