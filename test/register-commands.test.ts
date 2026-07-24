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
      clearRawTranscriptRecovery: vi.fn(),
      checkSidecarHealth: vi.fn(async () => {}),
      copyRawTranscript: vi.fn(),
      hasLastUtterance: () => available,
      hasRawTranscriptRecovery: () => false,
      isReadAloudActive: () => false,
      plugin,
      readAloud: vi.fn(async () => {}),
      reinsertLastUtterance,
      restoreRawTranscript: vi.fn(),
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopReadAloud: vi.fn(),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
      toggleReadAloudPaused: vi.fn(async () => {}),
    });
    const reinsertCommand = commands.find(({ id }) => id === 'reinsert-last-utterance');
    const clearCommand = commands.find(({ id }) => id === 'clear-last-utterance');
    const editor = {} as Editor;

    expect(reinsertCommand?.name).toBe('Reinsert last utterance');
    expect(clearCommand?.name).toBe('Clear last utterance');
    expect(commands.some(({ id }) => id === 'copy-last-utterance')).toBe(false);
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

  it('gates raw transcript recovery commands on one shared availability source', () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    let available = false;
    const clearRawTranscriptRecovery = vi.fn(() => {
      available = false;
    });
    const copyRawTranscript = vi.fn();
    const restoreRawTranscript = vi.fn();
    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      clearLastUtterance: vi.fn(),
      clearRawTranscriptRecovery,
      checkSidecarHealth: vi.fn(async () => {}),
      copyRawTranscript,
      hasLastUtterance: () => false,
      hasRawTranscriptRecovery: () => available,
      isReadAloudActive: () => false,
      plugin,
      readAloud: vi.fn(async () => {}),
      reinsertLastUtterance: vi.fn(),
      restoreRawTranscript,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopReadAloud: vi.fn(),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
      toggleReadAloudPaused: vi.fn(async () => {}),
    });
    const restoreCommand = commands.find(({ id }) => id === 'restore-raw-transcript');
    const copyCommand = commands.find(({ id }) => id === 'copy-raw-transcript');
    const clearCommand = commands.find(({ id }) => id === 'clear-raw-transcript-recovery');

    expect(restoreCommand?.name).toBe('Restore raw transcript');
    expect(copyCommand?.name).toBe('Copy raw transcript');
    expect(clearCommand?.name).toBe('Clear raw recovery');
    expect(restoreCommand?.checkCallback?.(true)).toBe(false);
    expect(copyCommand?.checkCallback?.(true)).toBe(false);
    expect(clearCommand?.checkCallback?.(true)).toBe(false);

    available = true;
    expect(restoreCommand?.checkCallback?.(true)).toBe(true);
    expect(copyCommand?.checkCallback?.(true)).toBe(true);
    expect(clearCommand?.checkCallback?.(true)).toBe(true);
    expect(restoreRawTranscript).not.toHaveBeenCalled();
    expect(copyRawTranscript).not.toHaveBeenCalled();
    expect(clearRawTranscriptRecovery).not.toHaveBeenCalled();

    expect(restoreCommand?.checkCallback?.(false)).toBe(true);
    expect(copyCommand?.checkCallback?.(false)).toBe(true);
    expect(clearCommand?.checkCallback?.(false)).toBe(true);
    expect(restoreRawTranscript).toHaveBeenCalledOnce();
    expect(copyRawTranscript).toHaveBeenCalledOnce();
    expect(clearRawTranscriptRecovery).toHaveBeenCalledOnce();
    expect(restoreCommand?.checkCallback?.(true)).toBe(false);
  });

  it('registers one read-aloud start command', () => {
    const commands: Command[] = [];
    const plugin = {
      addCommand: vi.fn((command: Command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;

    registerCommands({
      cancelDictation: vi.fn(async () => {}),
      clearLastUtterance: vi.fn(),
      clearRawTranscriptRecovery: vi.fn(),
      checkSidecarHealth: vi.fn(async () => {}),
      copyRawTranscript: vi.fn(),
      hasLastUtterance: () => false,
      hasRawTranscriptRecovery: () => false,
      isReadAloudActive: () => false,
      plugin,
      readAloud: vi.fn(async () => {}),
      reinsertLastUtterance: vi.fn(),
      restoreRawTranscript: vi.fn(),
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopReadAloud: vi.fn(),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
      toggleReadAloudPaused: vi.fn(async () => {}),
    });

    expect(commands.filter(({ id }) => id === 'read-aloud')).toHaveLength(1);
    expect(commands.some(({ id }) => id === 'read-entire-note')).toBe(false);
  });
});
