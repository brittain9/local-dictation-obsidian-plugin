import type { Editor, Plugin } from 'obsidian';

const START_DICTATION_COMMAND_ID = 'start-dictation-session';
const STOP_DICTATION_COMMAND_ID = 'stop-dictation-session';
const CANCEL_DICTATION_COMMAND_ID = 'cancel-dictation-session';
const TOGGLE_DICTATION_COMMAND_ID = 'toggle-dictation-session';
const REINSERT_LAST_UTTERANCE_COMMAND_ID = 'reinsert-last-utterance';
const CLEAR_LAST_UTTERANCE_COMMAND_ID = 'clear-last-utterance';
const RESTORE_RAW_TRANSCRIPT_COMMAND_ID = 'restore-raw-transcript';
const COPY_RAW_TRANSCRIPT_COMMAND_ID = 'copy-raw-transcript';
const CLEAR_RAW_RECOVERY_COMMAND_ID = 'clear-raw-transcript-recovery';

interface CommandDependencies {
  cancelDictation: () => Promise<void>;
  clearLastUtterance: () => void;
  clearRawTranscriptRecovery: () => void;
  checkSidecarHealth: () => Promise<void>;
  copyRawTranscript: () => void;
  hasRawTranscriptRecovery: () => boolean;
  plugin: Plugin;
  hasLastUtterance: () => boolean;
  reinsertLastUtterance: (editor: Editor) => void;
  restoreRawTranscript: () => void;
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
      if (!dependencies.hasLastUtterance()) {
        return false;
      }
      if (!checking) {
        dependencies.reinsertLastUtterance(editor);
      }
      return true;
    },
  });

  dependencies.plugin.addCommand({
    id: CLEAR_LAST_UTTERANCE_COMMAND_ID,
    name: 'Clear last utterance',
    checkCallback: (checking) => {
      if (!dependencies.hasLastUtterance()) {
        return false;
      }
      if (!checking) {
        dependencies.clearLastUtterance();
      }
      return true;
    },
  });

  dependencies.plugin.addCommand({
    id: RESTORE_RAW_TRANSCRIPT_COMMAND_ID,
    name: 'Restore raw transcript',
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.restoreRawTranscript,
      ),
  });

  dependencies.plugin.addCommand({
    id: COPY_RAW_TRANSCRIPT_COMMAND_ID,
    name: 'Copy raw transcript',
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.copyRawTranscript,
      ),
  });

  dependencies.plugin.addCommand({
    id: CLEAR_RAW_RECOVERY_COMMAND_ID,
    name: 'Clear raw recovery',
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.clearRawTranscriptRecovery,
      ),
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

function runAvailableCommand(
  checking: boolean,
  isAvailable: () => boolean,
  run: () => void,
): boolean {
  if (!isAvailable()) {
    return false;
  }
  if (!checking) {
    run();
  }
  return true;
}
