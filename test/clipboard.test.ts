import { describe, expect, it, vi } from 'vitest';

import { tryWriteClipboardText } from '../src/shared/clipboard';

describe('tryWriteClipboardText', () => {
  it('writes the exact text through the available clipboard', async () => {
    const writeText = vi.fn(async (_text: string) => {});

    expect(await tryWriteClipboardText(() => ({ writeText }), 'copy exactly')).toBe(true);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('copy exactly');
  });

  it.each([null, undefined])('reports an unavailable clipboard as false', async (clipboard) => {
    expect(await tryWriteClipboardText(() => clipboard, 'private text')).toBe(false);
  });

  it('contains provider and write failures without returning their details', async () => {
    const privateText = 'private clipboard text';
    const providerError = new Error(`provider rejected ${privateText}`);
    const writeError = new Error(`write rejected ${privateText}`);

    await expect(
      tryWriteClipboardText(() => {
        throw providerError;
      }, privateText),
    ).resolves.toBe(false);
    await expect(
      tryWriteClipboardText(
        () => ({
          writeText: vi.fn(async () => {
            throw writeError;
          }),
        }),
        privateText,
      ),
    ).resolves.toBe(false);
  });
});
