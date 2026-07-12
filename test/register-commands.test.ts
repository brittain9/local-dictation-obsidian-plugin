import type { Command, Editor, Plugin, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { registerCommands } from '../src/commands/register-commands';

describe('registerCommands', () => {
  it('checks re-dictation eligibility without starting capture and executes only when available', () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const canRedictateSelection = vi.fn(() => available);
    const startSelectionRedictation = vi.fn(async () => {});
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      canRedictateSelection,
      checkSidecarHealth: vi.fn(async () => {}),
      plugin,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      startSelectionRedictation,
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
    });
    const command = commands.find(({ id }) => id === 'redictate-selection');
    const editor = {} as Editor;
    const file = { path: 'note.md' } as TFile;
    const context = { file } as never;

    expect(command?.name).toBe('Re-dictate selection');
    expect(command?.editorCheckCallback?.(true, editor, context)).toBe(false);
    expect(startSelectionRedictation).not.toHaveBeenCalled();

    available = true;
    expect(command?.editorCheckCallback?.(true, editor, context)).toBe(true);
    expect(startSelectionRedictation).not.toHaveBeenCalled();

    expect(command?.editorCheckCallback?.(false, editor, context)).toBe(true);
    expect(startSelectionRedictation).toHaveBeenCalledOnce();
    expect(startSelectionRedictation).toHaveBeenCalledWith(editor, file);
  });
});
