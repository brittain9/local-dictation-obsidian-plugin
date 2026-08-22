import type { Editor } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  ReadAloudFollowAlong,
  readAloudFollowAlongDecorationsField,
  readAloudFollowAlongStateField,
} from '../src/editor/read-aloud-follow-along';
import { StateBackedEditorView } from './fixtures/state-backed-editor-view';

type FakeLeaf = {
  view: { editor: Editor & { cm: StateBackedEditorView }; file: null };
};

function createWorkspace(leaves: FakeLeaf[]) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    getLeavesOfType: vi.fn(() => leaves),
    offref: vi.fn((ref: { name: string }) => listeners.delete(ref.name)),
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => {
      listeners.set(name, callback);
      return { name };
    }),
    trigger(name: string, ...args: unknown[]) {
      listeners.get(name)?.(...args);
    },
  };
}

function createEditor(source: string): { editor: Editor; view: StateBackedEditorView } {
  const view = new StateBackedEditorView(source, {
    extensions: [readAloudFollowAlongStateField, readAloudFollowAlongDecorationsField],
    selectionHead: 2,
  });
  const editor = {
    cm: view,
    getValue: () => source,
  } as unknown as Editor;
  return { editor, view };
}

function createHarness(source = 'First sentence. Second sentence.') {
  const first = createEditor(source);
  const second = createEditor(source);
  const leaves = [
    { view: { editor: first.editor, file: null } },
    { view: { editor: second.editor, file: null } },
  ] as unknown as FakeLeaf[];
  const workspace = createWorkspace(leaves);
  const manager = new ReadAloudFollowAlong(workspace as never, true);
  manager.registerView(first.view as never);
  manager.registerView(second.view as never);
  return { first, manager, second, workspace };
}

function decorationCount(view: StateBackedEditorView): number {
  let count = 0;
  view.state.field(readAloudFollowAlongDecorationsField).between(0, view.state.doc.length, () => {
    count += 1;
  });
  return count;
}

describe('ReadAloudFollowAlong', () => {
  it('decorates the exact range without changing selection or document text', () => {
    const harness = createHarness();
    const before = harness.first.view.state;
    const handle = harness.manager.begin(harness.first.editor, before.doc.toString());

    handle.setDesiredRange({ from: 2, to: 10 });

    expect(harness.first.view.state.doc.toString()).toBe(before.doc.toString());
    expect(harness.first.view.state.selection).toEqual(before.selection);
    expect(harness.first.view.state.field(readAloudFollowAlongStateField)).toEqual({
      from: 2,
      to: 10,
    });
    expect(decorationCount(harness.first.view)).toBe(1);
    expect(decorationCount(harness.second.view)).toBe(0);
  });

  it('clears immediately when disabled and restores the valid current range when re-enabled', () => {
    const harness = createHarness();
    const handle = harness.manager.begin(
      harness.first.editor,
      harness.first.view.state.doc.toString(),
    );
    handle.setDesiredRange({ from: 0, to: 5 });

    harness.manager.setEnabled(false);
    expect(decorationCount(harness.first.view)).toBe(0);
    harness.manager.setEnabled(true);
    expect(decorationCount(harness.first.view)).toBe(1);
  });

  it('invalidates after edits and rejects later progress from the old reading', () => {
    const harness = createHarness();
    const source = harness.first.view.state.doc.toString();
    const handle = harness.manager.begin(harness.first.editor, source);
    handle.setDesiredRange({ from: 0, to: 5 });

    harness.first.view.dispatch({
      changes: { from: 0, to: 0, insert: 'Changed ' },
    });
    harness.manager.handleDocumentChange(harness.first.view as never);
    handle.setDesiredRange({ from: 8, to: 15 });

    expect(decorationCount(harness.first.view)).toBe(0);
    expect(harness.first.view.state.field(readAloudFollowAlongStateField)).toBeNull();
  });

  it('allows a new reading to target the edited document', () => {
    const harness = createHarness();
    harness.first.view.dispatch({ changes: { from: 0, to: 0, insert: 'Changed ' } });
    harness.manager.handleDocumentChange(harness.first.view as never);

    const source = harness.first.view.state.doc.toString();
    const handle = harness.manager.begin(harness.first.editor, source);
    handle.setDesiredRange({ from: 0, to: 7 });

    expect(decorationCount(harness.first.view)).toBe(1);
  });

  it('invalidates on leaf switches and destroyed source views', () => {
    const harness = createHarness();
    const handle = harness.manager.begin(
      harness.first.editor,
      harness.first.view.state.doc.toString(),
    );
    handle.setDesiredRange({ from: 0, to: 5 });

    harness.workspace.trigger('active-leaf-change', {});
    expect(decorationCount(harness.first.view)).toBe(0);

    const next = harness.manager.begin(
      harness.first.editor,
      harness.first.view.state.doc.toString(),
    );
    next.setDesiredRange({ from: 0, to: 5 });
    harness.manager.handleViewDestroyed(harness.first.view as never);
    next.setDesiredRange({ from: 5, to: 10 });
    expect(harness.first.view.state.field(readAloudFollowAlongStateField)).toEqual({
      from: 0,
      to: 5,
    });
  });

  it('fails safely for invalid ranges', () => {
    const harness = createHarness();
    const handle = harness.manager.begin(
      harness.first.editor,
      harness.first.view.state.doc.toString(),
    );

    handle.setDesiredRange({ from: -1, to: 4 });
    expect(decorationCount(harness.first.view)).toBe(0);
    handle.setDesiredRange({ from: 4, to: 4 });
    expect(decorationCount(harness.first.view)).toBe(0);
    handle.setDesiredRange({ from: 0, to: 10_000 });
    expect(decorationCount(harness.first.view)).toBe(0);
  });

  it('suppresses stale handles after a replacement reading', () => {
    const harness = createHarness();
    const source = harness.first.view.state.doc.toString();
    const first = harness.manager.begin(harness.first.editor, source);
    first.setDesiredRange({ from: 0, to: 5 });
    const second = harness.manager.begin(harness.first.editor, source);
    first.setDesiredRange({ from: 5, to: 10 });
    second.setDesiredRange({ from: 5, to: 10 });

    expect(harness.first.view.state.field(readAloudFollowAlongStateField)).toEqual({
      from: 5,
      to: 10,
    });
  });

  it('does not target translated or targetless playback', () => {
    const harness = createHarness();
    const handle = harness.manager.begin(null, 'Translated preview');
    handle.setDesiredRange({ from: 0, to: 5 });

    expect(decorationCount(harness.first.view)).toBe(0);
    expect(decorationCount(harness.second.view)).toBe(0);
  });
});
