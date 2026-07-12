import type { Command, Editor, Plugin } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { registerCommands } from '../src/commands/register-commands';

describe('registerCommands', () => {
  it('exposes recovery commands only while a retained utterance is available', () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const clearLastUtterance = vi.fn(() => {
      available = false;
    });
    const reinsertLastUtterance = vi.fn((_editor: Editor) => {});
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      clearLastUtterance,
      checkSidecarHealth: vi.fn(async () => {}),
      hasLastUtterance: () => available,
      plugin,
      reinsertLastUtterance,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
    });
    const reinsertCommand = commands.find(({ id }) => id === 'reinsert-last-utterance');
    const clearCommand = commands.find(({ id }) => id === 'clear-last-utterance');
    const editor = {} as Editor;

    expect(reinsertCommand?.name).toBe('Reinsert last utterance');
    expect(clearCommand?.name).toBe('Clear last utterance');
    expect(reinsertCommand?.editorCheckCallback?.(true, editor, {} as never)).toBe(false);
    expect(clearCommand?.checkCallback?.(true)).toBe(false);
    expect(reinsertLastUtterance).not.toHaveBeenCalled();
    expect(clearLastUtterance).not.toHaveBeenCalled();

    available = true;
    expect(reinsertCommand?.editorCheckCallback?.(true, editor, {} as never)).toBe(true);
    expect(clearCommand?.checkCallback?.(true)).toBe(true);
    expect(reinsertLastUtterance).not.toHaveBeenCalled();
    expect(clearLastUtterance).not.toHaveBeenCalled();

    expect(reinsertCommand?.editorCheckCallback?.(false, editor, {} as never)).toBe(true);
    expect(reinsertLastUtterance).toHaveBeenCalledOnce();
    expect(reinsertLastUtterance).toHaveBeenCalledWith(editor);

    expect(clearCommand?.checkCallback?.(false)).toBe(true);
    expect(clearLastUtterance).toHaveBeenCalledOnce();
    expect(reinsertCommand?.editorCheckCallback?.(true, editor, {} as never)).toBe(false);
    expect(clearCommand?.checkCallback?.(true)).toBe(false);
  });
});
