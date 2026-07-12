import type { Editor, Plugin } from 'obsidian';

const START_DICTATION_COMMAND_ID = 'start-dictation-session';
const STOP_DICTATION_COMMAND_ID = 'stop-dictation-session';
const CANCEL_DICTATION_COMMAND_ID = 'cancel-dictation-session';
const TOGGLE_DICTATION_COMMAND_ID = 'toggle-dictation-session';
const REINSERT_LAST_UTTERANCE_COMMAND_ID = 'reinsert-last-utterance';

interface CommandDependencies {
  cancelDictation: () => Promise<void>;
  checkSidecarHealth: () => Promise<void>;
  plugin: Plugin;
  canReinsertLastUtterance: () => boolean;
  reinsertLastUtterance: (editor: Editor) => void;
  restartSidecar: () => Promise<void>;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  toggleDictation: () => Promise<void>;
}

export function registerCommands(dependencies: CommandDependencies): void {
  dependencies.plugin.addCommand({
    id: TOGGLE_DICTATION_COMMAND_ID,
    name: 'Toggle dictation',
    callback: async () => {
      await dependencies.toggleDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: START_DICTATION_COMMAND_ID,
    name: 'Start dictation',
    callback: async () => {
      await dependencies.startDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: STOP_DICTATION_COMMAND_ID,
    name: 'Stop dictation',
    callback: async () => {
      await dependencies.stopDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: CANCEL_DICTATION_COMMAND_ID,
    name: 'Cancel dictation',
    callback: async () => {
      await dependencies.cancelDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: REINSERT_LAST_UTTERANCE_COMMAND_ID,
    name: 'Reinsert last utterance',
    editorCheckCallback: (checking, editor) => {
      if (!dependencies.canReinsertLastUtterance()) {
        return false;
      }
      if (!checking) {
        dependencies.reinsertLastUtterance(editor);
      }
      return true;
    },
  });

  dependencies.plugin.addCommand({
    id: 'check-sidecar-health',
    name: 'Check sidecar health',
    callback: async () => {
      await dependencies.checkSidecarHealth();
    },
  });

  dependencies.plugin.addCommand({
    id: 'restart-sidecar',
    name: 'Restart sidecar',
    callback: async () => {
      await dependencies.restartSidecar();
    },
  });
}
