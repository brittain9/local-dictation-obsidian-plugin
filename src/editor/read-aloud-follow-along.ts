import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { App, Editor, EventRef, TFile, WorkspaceLeaf } from 'obsidian';

import type { SourceRange } from '../sidecar/protocol';

interface EditorWithCodeMirror extends Editor {
  cm?: EditorView;
}

interface MarkdownLeafLike {
  view?: {
    editor?: EditorWithCodeMirror;
    file: TFile | null;
  };
}

interface FollowAlongTarget {
  leaf: WorkspaceLeaf;
  source: string;
  view: EditorView;
}

interface FollowAlongOperation {
  invalidated: boolean;
  range: SourceRange | null;
  target: FollowAlongTarget | null;
}

export interface ReadAloudFollowAlongHandle {
  setDesiredRange(range: SourceRange | null): void;
}

const setFollowAlongRangeEffect = StateEffect.define<SourceRange | null>();

export const readAloudFollowAlongStateField = StateField.define<SourceRange | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged) return null;

    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(setFollowAlongRangeEffect)) continue;
      next = effect.value;
    }
    return next;
  },
});

const FOLLOW_ALONG_DECORATION = Decoration.mark({ class: 'local-stt-read-aloud-follow-along' });

export const readAloudFollowAlongDecorationsField = StateField.define<DecorationSet>({
  create: (state) => decorationsFor(state),
  update: (_value, transaction) => decorationsFor(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});

function decorationsFor(state: EditorState): DecorationSet {
  const range = state.field(readAloudFollowAlongStateField, false);
  if (range === undefined || range === null || range.from >= range.to) {
    return Decoration.none;
  }
  if (range.from < 0 || range.to > state.doc.length) {
    return Decoration.none;
  }
  return Decoration.set([FOLLOW_ALONG_DECORATION.range(range.from, range.to)]);
}

export function readAloudFollowAlongExtension(manager: ReadAloudFollowAlong): Extension {
  class FollowAlongViewPlugin {
    constructor(readonly view: EditorView) {
      manager.registerView(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) manager.handleDocumentChange(update.view);
    }

    destroy(): void {
      manager.handleViewDestroyed(this.view);
    }
  }

  return [
    readAloudFollowAlongStateField,
    readAloudFollowAlongDecorationsField,
    ViewPlugin.fromClass(FollowAlongViewPlugin),
  ];
}

export class ReadAloudFollowAlong {
  private readonly eventRefs: EventRef[] = [];
  private readonly registeredViews = new Set<EditorView>();
  private currentOperation: FollowAlongOperation | null = null;
  private disposed = false;
  private enabled: boolean;

  constructor(
    private readonly workspace: App['workspace'],
    enabled: boolean,
  ) {
    this.enabled = enabled;
    this.eventRefs.push(
      this.workspace.on('active-leaf-change', (leaf) => this.handleActiveLeafChange(leaf)),
      this.workspace.on('file-open', () => this.invalidateCurrentOperation()),
    );
  }

  begin(editor: Editor | null, source: string): ReadAloudFollowAlongHandle {
    this.invalidateCurrentOperation();
    const operation: FollowAlongOperation = {
      invalidated: false,
      range: null,
      target: editor === null ? null : this.resolveTarget(editor, source),
    };
    this.currentOperation = operation;

    return {
      setDesiredRange: (range) => {
        if (this.disposed || this.currentOperation !== operation || operation.invalidated) return;
        operation.range = range;
        this.render(operation);
      },
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (this.currentOperation !== null) this.render(this.currentOperation);
  }

  registerView(view: EditorView): void {
    if (this.disposed) return;
    this.registeredViews.add(view);
  }

  handleDocumentChange(view: EditorView): void {
    const operation = this.currentOperation;
    if (operation?.target?.view !== view) return;
    operation.invalidated = true;
    operation.range = null;
    this.clearTarget(operation.target);
  }

  handleViewDestroyed(view: EditorView): void {
    this.registeredViews.delete(view);
    const operation = this.currentOperation;
    if (operation?.target?.view !== view) return;
    operation.invalidated = true;
    operation.range = null;
    this.currentOperation = operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateCurrentOperation();
    for (const view of this.registeredViews) this.clearView(view);
    this.registeredViews.clear();
    for (const ref of this.eventRefs) this.workspace.offref(ref);
    this.eventRefs.length = 0;
  }

  private resolveTarget(editor: Editor, source: string): FollowAlongTarget | null {
    for (const leaf of this.workspace.getLeavesOfType(
      'markdown',
    ) as unknown as MarkdownLeafLike[]) {
      const editorView = leaf.view?.editor;
      const view = editorView?.cm;
      if (editorView !== editor || view === undefined) continue;
      return { leaf: leaf as unknown as WorkspaceLeaf, source, view };
    }
    return null;
  }

  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const target = this.currentOperation?.target;
    if (target !== null && target !== undefined && target.leaf !== leaf) {
      this.invalidateCurrentOperation();
    }
  }

  private invalidateCurrentOperation(): void {
    const operation = this.currentOperation;
    if (operation === null) return;
    operation.invalidated = true;
    operation.range = null;
    if (operation.target !== null) this.clearTarget(operation.target);
    this.currentOperation = null;
  }

  private render(operation: FollowAlongOperation): void {
    const target = operation.target;
    if (
      target === null ||
      operation.invalidated ||
      !this.enabled ||
      operation.range === null ||
      !this.isTargetCurrent(operation)
    ) {
      if (target !== null) this.clearTarget(target);
      return;
    }

    const range = operation.range;
    if (
      range.from < 0 ||
      range.from >= range.to ||
      range.to > target.view.state.doc.length ||
      target.view.state.doc.toString() !== target.source
    ) {
      this.clearTarget(target);
      return;
    }

    this.dispatchRange(target.view, range);
  }

  private isTargetCurrent(operation: FollowAlongOperation): boolean {
    const target = operation.target;
    return target !== null && this.registeredViews.has(target.view);
  }

  private clearTarget(target: FollowAlongTarget): void {
    this.clearView(target.view);
  }

  private clearView(view: EditorView): void {
    if (!this.registeredViews.has(view)) return;
    this.dispatchRange(view, null);
  }

  private dispatchRange(view: EditorView, range: SourceRange | null): void {
    const current = view.state.field(readAloudFollowAlongStateField, false);
    if (current?.from === range?.from && current?.to === range?.to) return;
    view.dispatch({ effects: setFollowAlongRangeEffect.of(range) });
  }
}
