import {
  EditorSelection,
  EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import { vi } from 'vitest';

export class StateBackedEditorView {
  state: EditorState;
  readonly dispatch = vi.fn((spec: TransactionSpec) => {
    this.state = this.state.update(spec).state;
  });

  constructor(
    documentText: string,
    options: { extensions?: Extension; selectionHead?: number } = {},
  ) {
    this.state = EditorState.create({
      doc: documentText,
      extensions: options.extensions ?? [],
      selection: EditorSelection.cursor(options.selectionHead ?? 0),
    });
  }
}
