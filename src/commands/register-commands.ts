import type { Editor, Plugin } from 'obsidian';
import { t } from '../shared/i18n';

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
  copyLastUtterance: () => void;
  copyRawTranscript: () => void;
  hasRawTranscriptRecovery: () => boolean;
  isReadAloudActive: () => boolean;
  isDeveloperMode?: () => boolean;
  plugin: Plugin;
  hasLastUtterance: () => boolean;
  reinsertLastUtterance: (editor: Editor) => void;
  restoreRawTranscript: () => void;
  restartSidecar: () => Promise<void>;
  readAloud: (editor: Editor) => Promise<void>;
  stopReadAloud: () => void;
  translateNote: (editor: Editor) => void;
  translateSelection: (editor: Editor) => void;
  translateNoteWithTencentPrototype?: (editor: Editor) => void;
  translateSelectionWithTencentPrototype?: (editor: Editor) => void;
  toggleReadAloudPaused: () => Promise<void>;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  toggleDictation: () => Promise<void>;
}

export function registerCommands(dependencies: CommandDependencies): void {
  dependencies.plugin.addCommand({
    id: 'translate-selection',
    name: t('commands.translateSelection'),
    editorCheckCallback: (checking, editor) => {
      if (!editor.somethingSelected()) return false;
      if (!checking) dependencies.translateSelection(editor);
      return true;
    },
  });

  if (
    dependencies.isDeveloperMode !== undefined &&
    dependencies.translateNoteWithTencentPrototype !== undefined &&
    dependencies.translateSelectionWithTencentPrototype !== undefined
  ) {
    const isDeveloperMode = dependencies.isDeveloperMode;
    const translateNote = dependencies.translateNoteWithTencentPrototype;
    const translateSelection = dependencies.translateSelectionWithTencentPrototype;
    dependencies.plugin.addCommand({
      id: 'prototype-translate-selection-tencent-hy-mt',
      name: 'Prototype: Translate selection with Tencent HY-MT',
      editorCheckCallback: (checking, editor) => {
        if (!isDeveloperMode() || !editor.somethingSelected()) return false;
        if (!checking) translateSelection(editor);
        return true;
      },
    });

    dependencies.plugin.addCommand({
      id: 'prototype-translate-note-tencent-hy-mt',
      name: 'Prototype: Translate note with Tencent HY-MT',
      editorCheckCallback: (checking, editor) => {
        if (!isDeveloperMode()) return false;
        if (!checking) translateNote(editor);
        return true;
      },
    });
  }

  dependencies.plugin.addCommand({
    id: 'translate-note',
    name: t('commands.translateNote'),
    editorCallback: (editor) => dependencies.translateNote(editor),
  });

  dependencies.plugin.addCommand({
    id: 'read-aloud',
    name: t('commands.readAloud'),
    editorCallback: async (editor) => dependencies.readAloud(editor),
  });

  dependencies.plugin.addCommand({
    id: 'pause-resume-read-aloud',
    name: t('commands.pauseResumeReadAloud'),
    checkCallback: (checking) => {
      if (!dependencies.isReadAloudActive()) return false;
      if (!checking) void dependencies.toggleReadAloudPaused();
      return true;
    },
  });

  dependencies.plugin.addCommand({
    id: 'stop-read-aloud',
    name: t('commands.stopReadAloud'),
    checkCallback: (checking) => {
      if (!dependencies.isReadAloudActive()) return false;
      if (!checking) dependencies.stopReadAloud();
      return true;
    },
  });

  dependencies.plugin.addCommand({
    id: TOGGLE_DICTATION_COMMAND_ID,
    name: t('commands.toggleDictation'),
    callback: async () => {
      await dependencies.toggleDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: START_DICTATION_COMMAND_ID,
    name: t('commands.startDictation'),
    callback: async () => {
      await dependencies.startDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: STOP_DICTATION_COMMAND_ID,
    name: t('commands.stopDictation'),
    callback: async () => {
      await dependencies.stopDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: CANCEL_DICTATION_COMMAND_ID,
    name: t('commands.cancelDictation'),
    callback: async () => {
      await dependencies.cancelDictation();
    },
  });

  dependencies.plugin.addCommand({
    id: REINSERT_LAST_UTTERANCE_COMMAND_ID,
    name: t('commands.reinsertLastUtterance'),
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
    name: t('commands.clearLastUtterance'),
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
    id: 'copy-last-utterance',
    name: t('commands.copyLastUtterance'),
    checkCallback: (checking) =>
      runAvailableCommand(checking, dependencies.hasLastUtterance, dependencies.copyLastUtterance),
  });

  dependencies.plugin.addCommand({
    id: RESTORE_RAW_TRANSCRIPT_COMMAND_ID,
    name: t('commands.restoreRawTranscript'),
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.restoreRawTranscript,
      ),
  });

  dependencies.plugin.addCommand({
    id: COPY_RAW_TRANSCRIPT_COMMAND_ID,
    name: t('commands.copyRawTranscript'),
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.copyRawTranscript,
      ),
  });

  dependencies.plugin.addCommand({
    id: CLEAR_RAW_RECOVERY_COMMAND_ID,
    name: t('commands.clearRawRecovery'),
    checkCallback: (checking) =>
      runAvailableCommand(
        checking,
        dependencies.hasRawTranscriptRecovery,
        dependencies.clearRawTranscriptRecovery,
      ),
  });

  dependencies.plugin.addCommand({
    id: 'check-sidecar-health',
    name: t('commands.checkSidecarHealth'),
    callback: async () => {
      await dependencies.checkSidecarHealth();
    },
  });

  dependencies.plugin.addCommand({
    id: 'restart-sidecar',
    name: t('commands.restartSidecar'),
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
