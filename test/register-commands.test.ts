import type { Command, Editor, Plugin } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { registerCommands } from '../src/commands/register-commands';

describe('registerCommands', () => {
  it('exposes reinsert last utterance only when recovery is available', () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const reinsertLastUtterance = vi.fn((_editor: Editor) => {});
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      canReinsertLastUtterance: () => available,
      checkSidecarHealth: vi.fn(async () => {}),
      plugin,
      reinsertLastUtterance,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
    });
    const command = commands.find(({ id }) => id === 'reinsert-last-utterance');
    const editor = {} as Editor;

    expect(command?.name).toBe('Reinsert last utterance');
    expect(command?.editorCheckCallback?.(true, editor, {} as never)).toBe(false);
    expect(reinsertLastUtterance).not.toHaveBeenCalled();

    available = true;
    expect(command?.editorCheckCallback?.(true, editor, {} as never)).toBe(true);
    expect(reinsertLastUtterance).not.toHaveBeenCalled();

    expect(command?.editorCheckCallback?.(false, editor, {} as never)).toBe(true);
    expect(reinsertLastUtterance).toHaveBeenCalledOnce();
    expect(reinsertLastUtterance).toHaveBeenCalledWith(editor);
  });
});
