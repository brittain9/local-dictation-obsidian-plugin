import type { Plugin } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { registerCommands } from '../src/commands/register-commands';

interface RegisteredCommand {
  callback: () => Promise<void>;
  id: string;
  name: string;
}

describe('registerCommands', () => {
  it('registers dictation and sidecar commands including toggle dictation', async () => {
    const commands: RegisteredCommand[] = [];
    const plugin = {
      addCommand: vi.fn((command: RegisteredCommand) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
    const dependencies = {
      cancelDictation: vi.fn(async () => {}),
      checkSidecarHealth: vi.fn(async () => {}),
      plugin,
      restartSidecar: vi.fn(async () => {}),
      startDictation: vi.fn(async () => {}),
      stopDictation: vi.fn(async () => {}),
      toggleDictation: vi.fn(async () => {}),
    };

    registerCommands(dependencies);

    expect(commands.map((command) => [command.id, command.name])).toEqual([
      ['toggle-dictation-session', 'Toggle Dictation Session'],
      ['start-dictation-session', 'Start Dictation Session'],
      ['stop-dictation-session', 'Stop Dictation Session'],
      ['cancel-dictation-session', 'Cancel Dictation Session'],
      ['check-sidecar-health', 'Check Sidecar Health'],
      ['restart-sidecar', 'Restart Sidecar'],
    ]);

    await commands[0]?.callback();

    expect(dependencies.toggleDictation).toHaveBeenCalledTimes(1);
    expect(dependencies.startDictation).not.toHaveBeenCalled();
    expect(dependencies.stopDictation).not.toHaveBeenCalled();
    expect(dependencies.cancelDictation).not.toHaveBeenCalled();
  });
});
