import type { Command, Editor, Plugin, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { registerCommands } from '../src/commands/register-commands';

describe('registerCommands', () => {
  it('checks eligibility and contains an unexpected re-dictation startup rejection', async () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const canRedictateSelection = vi.fn(() => available);
    const startError = new Error('unexpected startup failure');
    const startSelectionRedictation = vi.fn(async () => {
      throw startError;
    });
    const onSelectionRedictationError = vi.fn();
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      canCaptureMarkdownCommand: vi.fn(() => false),
      canRedictateSelection,
      checkSidecarHealth: vi.fn(async () => {}),
      onMarkdownCommandError: vi.fn(),
      onSelectionRedictationError,
      plugin,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      startMarkdownCommand: vi.fn(async () => {}),
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
    await vi.waitFor(() => {
      expect(onSelectionRedictationError).toHaveBeenCalledWith(startError);
    });
  });

  it('registers Markdown command mode and contains an unexpected startup rejection', async () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const canCaptureMarkdownCommand = vi.fn(() => available);
    const startError = new Error('unexpected Markdown command failure');
    const startMarkdownCommand = vi.fn(async () => {
      throw startError;
    });
    const onMarkdownCommandError = vi.fn();
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      canCaptureMarkdownCommand,
      canRedictateSelection: vi.fn(() => false),
      checkSidecarHealth: vi.fn(async () => {}),
      onMarkdownCommandError,
      onSelectionRedictationError: vi.fn(),
      plugin,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      startMarkdownCommand,
      startSelectionRedictation: vi.fn(async () => {}),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
    });
    const command = commands.find(({ id }) => id === 'markdown-command-mode');
    const editor = {} as Editor;
    const file = { path: 'note.md' } as TFile;
    const context = { file } as never;

    expect(command?.name).toBe('Apply Markdown by voice');
    expect(command?.editorCheckCallback?.(true, editor, context)).toBe(false);
    expect(startMarkdownCommand).not.toHaveBeenCalled();

    available = true;
    expect(command?.editorCheckCallback?.(true, editor, context)).toBe(true);
    expect(startMarkdownCommand).not.toHaveBeenCalled();

    expect(command?.editorCheckCallback?.(false, editor, context)).toBe(true);
    expect(startMarkdownCommand).toHaveBeenCalledWith(editor, file);
    await vi.waitFor(() => {
      expect(onMarkdownCommandError).toHaveBeenCalledWith(startError);
    });
  });
});
