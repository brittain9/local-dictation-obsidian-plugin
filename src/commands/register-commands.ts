import type { Editor, Plugin, TFile } from 'obsidian';

const START_DICTATION_COMMAND_ID = 'start-dictation-session';
const STOP_DICTATION_COMMAND_ID = 'stop-dictation-session';
const CANCEL_DICTATION_COMMAND_ID = 'cancel-dictation-session';
const TOGGLE_DICTATION_COMMAND_ID = 'toggle-dictation-session';
const REDICTATE_SELECTION_COMMAND_ID = 'redictate-selection';

interface CommandDependencies {
  cancelDictation: () => Promise<void>;
  canRedictateSelection: (editor: Editor, file: TFile | null) => boolean;
  checkSidecarHealth: () => Promise<void>;
  plugin: Plugin;
  restartSidecar: () => Promise<void>;
  startSelectionRedictation: (editor: Editor, file: TFile | null) => Promise<void>;
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
    id: REDICTATE_SELECTION_COMMAND_ID,
    name: 'Re-dictate selection',
    editorCheckCallback: (checking, editor, context) => {
      if (!dependencies.canRedictateSelection(editor, context.file)) {
        return false;
      }
      if (!checking) {
        void dependencies.startSelectionRedictation(editor, context.file);
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
