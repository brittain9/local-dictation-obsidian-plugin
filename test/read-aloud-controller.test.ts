import type { Editor, EditorPosition } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogRecord } from '../src/models/model-management-types';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { StartSynthesisCommand } from '../src/sidecar/protocol';
import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from '../src/sidecar/sidecar-lifecycle-gate';

const playback = vi.hoisted(() => ({
  enqueue: vi.fn(),
  markGenerationComplete: vi.fn(),
  playThrough: vi.fn<(sequence: number) => void>(),
  start: vi.fn(),
  stop: vi.fn(),
  togglePaused: vi.fn(async () => false),
}));

vi.mock('../src/audio/pcm-playback-queue', () => ({
  PcmPlaybackQueue: class {
    constructor(options: { onPlayedThrough: (sequence: number) => void }) {
      playback.playThrough.mockImplementation(options.onPlayedThrough);
    }

    enqueue = playback.enqueue;
    markGenerationComplete = playback.markGenerationComplete;
    start = playback.start;
    stop = playback.stop;
    togglePaused = playback.togglePaused;
  },
}));

import { ReadAloudController, resolveReadRange } from '../src/tts/read-aloud-controller';

function editorFor(source: string, cursor: EditorPosition, selection?: [number, number]): Editor {
  const lines = source.split('\n');
  const offset = (position: EditorPosition): number => {
    let result = 0;
    for (let line = 0; line < position.line; line += 1) result += (lines[line]?.length ?? 0) + 1;
    return result + position.ch;
  };
  const position = (value: number): EditorPosition => {
    let remaining = value;
    for (let line = 0; line < lines.length; line += 1) {
      const length = lines[line]?.length ?? 0;
      if (remaining <= length) return { ch: remaining, line };
      remaining -= length + 1;
    }
    return { ch: 0, line: lines.length - 1 };
  };
  return {
    getValue: () => source,
    getCursor: (side?: string) => {
      if (selection === undefined) return cursor;
      return side === 'anchor' ? position(selection[0]) : position(selection[1]);
    },
    getLine: (line: number) => lines[line] ?? '',
    posToOffset: offset,
    somethingSelected: () => selection !== undefined,
  } as unknown as Editor;
}

const TTS_SELECTION = {
  familyId: 'pocket_tts',
  kind: 'catalog_model',
  modelId: 'pocket_tts_english_2026_04_int8',
  runtimeId: 'onnx_runtime',
} as const;

const TTS_CATALOG = {
  catalogVersion: 1,
  collections: [],
  families: [],
  models: [
    {
      defaultVoice: 'alba',
      familyId: TTS_SELECTION.familyId,
      // Read aloud only speaks a language the selected voice model declares.
      languageTags: ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ja', 'hr'],
      modelId: TTS_SELECTION.modelId,
      runtimeId: TTS_SELECTION.runtimeId,
    },
  ],
} as unknown as ModelCatalogRecord;

type StartSynthesisMock = ReturnType<
  typeof vi.fn<(payload: Omit<StartSynthesisCommand, 'type'>) => Promise<void>>
>;

function controllerHarness(options: {
  catalog?: ModelCatalogRecord;
  readAloudLanguage?: 'auto' | 'en' | 'sr';
  onModelMissing?: () => Promise<void> | void;
  selected: boolean;
  selectedVoice?: string | null;
  sidecarLifecycleGate?: SidecarLifecycleGate;
  startSynthesis?: StartSynthesisMock;
}) {
  const feedback = { show: vi.fn() };
  const stopDictation = vi.fn(async (): Promise<void> => undefined);
  const cancelSynthesis = vi.fn();
  const onModelMissing = options.onModelMissing ?? vi.fn();
  const startSynthesis =
    options.startSynthesis ??
    vi.fn(async (_payload: Omit<StartSynthesisCommand, 'type'>) => undefined);
  const controller = new ReadAloudController({
    feedback,
    getCatalog: () => options.catalog ?? TTS_CATALOG,
    getSettings: () => ({
      ...DEFAULT_PLUGIN_SETTINGS,
      readAloudLanguage: options.readAloudLanguage ?? DEFAULT_PLUGIN_SETTINGS.readAloudLanguage,
      selectedTtsModel: options.selected ? TTS_SELECTION : null,
      selectedTtsVoice:
        options.selectedVoice === undefined
          ? options.selected
            ? 'alba'
            : null
          : options.selectedVoice,
    }),
    isDictationBusy: () => true,
    onModelMissing,
    onStateChange: vi.fn(),
    sidecarConnection: {
      cancelSynthesis,
      reportSynthesisPlaybackPosition: vi.fn(),
      startSynthesis,
      subscribe: vi.fn(() => vi.fn()),
      subscribeSynthesisAudio: vi.fn(() => vi.fn()),
    },
    sidecarLifecycleGate: options.sidecarLifecycleGate ?? new SidecarLifecycleGate(),
    stopDictation,
  });
  return {
    cancelSynthesis,
    controller,
    feedback,
    onModelMissing,
    startSynthesis,
    stopDictation,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveReadRange', () => {
  it('reads an exact selection regardless of selection direction', () => {
    const source = 'Before selected after';
    expect(resolveReadRange(editorFor(source, { ch: 0, line: 0 }, [15, 7]), source)).toEqual({
      from: 7,
      to: 15,
    });
  });

  it('reads the entire note when there is no selection', () => {
    const source = 'First block\ncontinues\n\nCurrent block\ncontinues\n\nLast';
    const editor = editorFor(source, { ch: 3, line: 4 });
    expect(resolveReadRange(editor, source)).toEqual({
      from: 0,
      to: source.length,
    });
  });

  it('can explicitly read the entire note even while text is selected', () => {
    const source = 'First sentence. Second sentence.';
    const editor = editorFor(source, { ch: 0, line: 0 }, [0, 15]);

    expect(resolveReadRange(editor, source, 'entire_note')).toEqual({
      from: 0,
      to: source.length,
    });
  });
});

describe('ReadAloudController', () => {
  it('refuses a start synchronously while sidecar maintenance is active', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    const mutation = sidecarLifecycleGate.acquireMutation();
    const harness = controllerHarness({ selected: true, sidecarLifecycleGate });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.stopDictation).not.toHaveBeenCalled();
    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'sidecar-maintenance',
      message:
        'The speech engine is being installed or restarted. Wait for it to finish, then try again.',
    });
    mutation.release();
  });

  it('holds its speech lease until a stopped asynchronous start has unwound', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    let completeStart: (() => void) | undefined;
    const startSynthesis = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeStart = resolve;
        }),
    );
    const harness = controllerHarness({
      selected: true,
      sidecarLifecycleGate,
      startSynthesis,
    });

    const reading = harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));
    await vi.waitFor(() => expect(startSynthesis).toHaveBeenCalledOnce());
    expect(() => sidecarLifecycleGate.acquireMutation()).toThrow(SidecarLifecycleConflictError);

    harness.controller.stop();
    harness.controller.stop();
    expect(() => sidecarLifecycleGate.acquireMutation()).toThrow(SidecarLifecycleConflictError);

    completeStart?.();
    await reading;
    const mutation = sidecarLifecycleGate.acquireMutation();
    mutation.release();
  });

  it('releases an active speech lease exactly once across repeated cleanup', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    const harness = controllerHarness({ selected: true, sidecarLifecycleGate });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));
    expect(() => sidecarLifecycleGate.acquireMutation()).toThrow(SidecarLifecycleConflictError);

    harness.controller.stop();
    harness.controller.dispose();
    harness.controller.stop();

    const mutation = sidecarLifecycleGate.acquireMutation();
    mutation.release();
  });

  it('restarts settings changes from the current sentence', async () => {
    const harness = controllerHarness({ selected: true });
    const editor = editorFor('First sentence. Second sentence. Third sentence.', {
      ch: 0,
      line: 0,
    });

    await harness.controller.read(editor);
    playback.playThrough(0);
    await harness.controller.applySpeed(1.5);

    expect(harness.startSynthesis).toHaveBeenCalledTimes(2);
    expect(harness.startSynthesis.mock.calls[1]?.[0]).toMatchObject({
      chunks: [{ text: 'Second sentence.' }, { text: 'Third sentence.' }],
      language: 'na',
      speed: 1.5,
    });
  });

  it('maps the model-default reading language to the neutral synthesis tag', async () => {
    const harness = controllerHarness({ readAloudLanguage: 'auto', selected: true });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.startSynthesis).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'na' }),
    );
  });

  it('refuses a language the voice model does not declare instead of speaking it neutrally', async () => {
    const harness = controllerHarness({ readAloudLanguage: 'sr', selected: true });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      message: 'The selected read-aloud model cannot speak Српски.',
    });
  });

  it.each([
    ['no selection', false, TTS_CATALOG],
    [
      'a selection missing from the catalog',
      true,
      { ...TTS_CATALOG, models: [] } as ModelCatalogRecord,
    ],
  ])('offers the same model setup action for %s', async (_scenario, selected, catalog) => {
    const harness = controllerHarness({ catalog, selected });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.stopDictation).not.toHaveBeenCalled();
    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.onModelMissing).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      action: {
        label: 'Choose model',
        run: expect.any(Function),
      },
      intent: 'action-required',
      key: 'read-aloud-model-required',
      message: 'Install and select a read-aloud model first.',
    });
  });

  it('opens model setup only when the user invokes the feedback action', async () => {
    const harness = controllerHarness({ selected: false });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.onModelMissing).not.toHaveBeenCalled();
    const request = harness.feedback.show.mock.calls[0]?.[0];
    if (request?.action === undefined) throw new Error('model setup action was not offered');

    request.action.run();

    await vi.waitFor(() => expect(harness.onModelMissing).toHaveBeenCalledOnce());
  });

  it('restores the model setup action when opening recovery fails', async () => {
    const onModelMissing = vi.fn(async () => {
      throw new Error('model picker failed');
    });
    const harness = controllerHarness({ onModelMissing, selected: false });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));
    const request = harness.feedback.show.mock.calls[0]?.[0];
    if (request?.action === undefined) throw new Error('model setup action was not offered');
    request.action.run();

    await vi.waitFor(() => expect(harness.feedback.show).toHaveBeenCalledTimes(2));
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      action: {
        label: 'Choose model',
        run: expect.any(Function),
      },
      cause: expect.any(Error),
      intent: 'action-required',
      key: 'read-aloud-model-required',
      message: 'Install and select a read-aloud model first.',
    });
  });

  it('restores the model setup action when recovery throws synchronously', async () => {
    const onModelMissing = vi.fn(() => {
      throw new Error('model picker threw');
    });
    const harness = controllerHarness({ onModelMissing, selected: false });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));
    const request = harness.feedback.show.mock.calls[0]?.[0];
    if (request?.action === undefined) throw new Error('model setup action was not offered');
    request.action.run();

    await vi.waitFor(() => expect(harness.feedback.show).toHaveBeenCalledTimes(2));
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      action: {
        label: 'Choose model',
        run: expect.any(Function),
      },
      cause: expect.any(Error),
      intent: 'action-required',
      key: 'read-aloud-model-required',
      message: 'Install and select a read-aloud model first.',
    });
  });

  it('uses the stable model-required key across repeated invocations', async () => {
    const harness = controllerHarness({ selected: false });
    const editor = editorFor('Speak this.', { ch: 0, line: 0 });

    await harness.controller.read(editor);
    await harness.controller.read(editor);

    expect(harness.feedback.show).toHaveBeenCalledTimes(2);
    expect(harness.feedback.show.mock.calls.map(([request]) => request.key)).toEqual([
      'read-aloud-model-required',
      'read-aloud-model-required',
    ]);
    expect(harness.onModelMissing).not.toHaveBeenCalled();
  });

  it('prioritizes no-text feedback without offering model setup', async () => {
    const harness = controllerHarness({ selected: false });

    await harness.controller.read(editorFor('   ', { ch: 0, line: 0 }));

    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      message: 'There is no speakable text here.',
    });
    expect(harness.onModelMissing).not.toHaveBeenCalled();
    expect(harness.stopDictation).not.toHaveBeenCalled();
    expect(harness.startSynthesis).not.toHaveBeenCalled();
  });

  it('keeps missing-voice feedback distinct from model setup', async () => {
    const harness = controllerHarness({
      catalog: {
        ...TTS_CATALOG,
        models: TTS_CATALOG.models.map(({ defaultVoice: _defaultVoice, ...model }) => model),
      },
      selected: true,
      selectedVoice: null,
    });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      message: 'Select an installed voice first.',
    });
    expect(harness.onModelMissing).not.toHaveBeenCalled();
    expect(harness.stopDictation).not.toHaveBeenCalled();
    expect(harness.startSynthesis).not.toHaveBeenCalled();
  });

  it('keeps the configured synthesis path free of setup feedback', async () => {
    const harness = controllerHarness({ selected: true });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.stopDictation).toHaveBeenCalledOnce();
    expect(harness.startSynthesis).toHaveBeenCalledOnce();
    expect(harness.onModelMissing).not.toHaveBeenCalled();
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('does not let a stale start failure clear a newer reading', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    const firstStart: { reject?: (error: unknown) => void } = {};
    const firstStartPromise = new Promise<void>((_resolve, reject) => {
      firstStart.reject = reject;
    });
    const startSynthesis = vi
      .fn<(payload: Omit<StartSynthesisCommand, 'type'>) => Promise<void>>()
      .mockReturnValueOnce(firstStartPromise)
      .mockResolvedValueOnce(undefined);
    const harness = controllerHarness({
      selected: true,
      sidecarLifecycleGate,
      startSynthesis,
    });
    const editor = editorFor('Speak this sentence.', { ch: 0, line: 0 });

    const first = harness.controller.read(editor);
    await vi.waitFor(() => expect(startSynthesis).toHaveBeenCalledOnce());
    await harness.controller.read(editor);
    if (firstStart.reject === undefined) throw new Error('first synthesis did not start');
    firstStart.reject(new Error('stale failure'));
    await first;

    expect(harness.controller.getState()).toBe('reading');
    expect(harness.feedback.show).not.toHaveBeenCalled();
    expect(() => sidecarLifecycleGate.acquireMutation()).toThrow(SidecarLifecycleConflictError);

    harness.controller.stop();
    const mutation = sidecarLifecycleGate.acquireMutation();
    mutation.release();
  });

  it('does not start after Stop cancels a read waiting for dictation to drain', async () => {
    const stop: { complete?: () => void } = {};
    const stopDictation = new Promise<void>((resolve) => {
      stop.complete = resolve;
    });
    const harness = controllerHarness({ selected: true });
    harness.stopDictation.mockReturnValueOnce(stopDictation);

    const reading = harness.controller.read(editorFor('Speak this sentence.', { ch: 0, line: 0 }));
    await vi.waitFor(() => expect(harness.stopDictation).toHaveBeenCalledOnce());
    harness.controller.stop();
    if (stop.complete === undefined) throw new Error('dictation stop did not start');
    stop.complete();
    await reading;

    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.controller.getState()).toBe('idle');
  });

  it('cancels again when Stop races with an asynchronous sidecar start', async () => {
    const start: { complete?: () => void } = {};
    const startPromise = new Promise<void>((resolve) => {
      start.complete = resolve;
    });
    const startSynthesis = vi.fn(() => startPromise);
    const harness = controllerHarness({ selected: true, startSynthesis });

    const reading = harness.controller.read(editorFor('Speak this sentence.', { ch: 0, line: 0 }));
    await vi.waitFor(() => expect(startSynthesis).toHaveBeenCalledOnce());
    harness.controller.stop();
    if (start.complete === undefined) throw new Error('synthesis start did not begin');
    start.complete();
    await reading;

    expect(harness.cancelSynthesis).toHaveBeenCalledTimes(2);
    expect(harness.cancelSynthesis).toHaveBeenLastCalledWith(1);
    expect(harness.controller.getState()).toBe('idle');
  });
});
