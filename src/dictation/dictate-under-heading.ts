import { type App, type Editor, FuzzySuggestModal } from 'obsidian';

import type { NotePlacementOptions } from '../editor/note-surface';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface SourceLine {
  readonly line: number;
  readonly start: number;
  readonly text: string;
}

export interface MarkdownHeadingTarget {
  readonly level: number;
  readonly line: number;
  readonly path: readonly string[];
  readonly sourceLine: string;
  readonly start: number;
  readonly text: string;
}

export interface HeadingDictationSelection {
  readonly documentText: string;
  readonly placement: NotePlacementOptions;
}

interface DictateUnderHeadingDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  onChoose: (selection: HeadingDictationSelection) => Promise<void>;
}

export function openDictateUnderHeadingPicker(
  app: App,
  editor: Editor,
  dependencies: DictateUnderHeadingDependencies,
): HeadingSuggestModal | null {
  const headings = findMarkdownHeadingTargets(editor.getValue());
  if (headings.length === 0) {
    dependencies.feedback.show({
      intent: 'information',
      key: 'dictate-under-heading-none',
      message: t('dictateUnderHeading.noHeadings'),
    });
    return null;
  }

  const modal = new HeadingSuggestModal(app, editor, headings, dependencies);
  modal.open();
  return modal;
}

export class HeadingSuggestModal extends FuzzySuggestModal<MarkdownHeadingTarget> {
  constructor(
    app: App,
    private readonly editor: Editor,
    private readonly headings: readonly MarkdownHeadingTarget[],
    private readonly dependencies: DictateUnderHeadingDependencies,
  ) {
    super(app);
    this.setPlaceholder(t('dictateUnderHeading.searchPlaceholder'));
  }

  getItems(): MarkdownHeadingTarget[] {
    return [...this.headings];
  }

  getItemText(item: MarkdownHeadingTarget): string {
    const path = item.path
      .map((part) => (part.length > 0 ? part : t('dictateUnderHeading.untitled')))
      .join(' › ');
    return t('dictateUnderHeading.pickerItem', {
      heading: path,
      level: item.level,
      line: item.line + 1,
    });
  }

  onChooseItem(item: MarkdownHeadingTarget): void {
    const documentText = this.editor.getValue();
    const placement = resolveHeadingSectionPlacement(documentText, item);
    if (placement === null) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'dictate-under-heading-changed',
        message: t('dictateUnderHeading.headingChanged'),
      });
      return;
    }

    void this.dependencies.onChoose({ documentText, placement });
  }
}

export function findMarkdownHeadingTargets(documentText: string): MarkdownHeadingTarget[] {
  const lines = readSourceLines(documentText);
  const headings: Array<Omit<MarkdownHeadingTarget, 'path'>> = [];
  let fence: { character: '`' | '~'; length: number } | null = null;
  let inFrontmatter = lines[0]?.text.trim() === '---';

  for (const sourceLine of lines) {
    if (inFrontmatter) {
      if (sourceLine.line > 0 && /^(?:---|\.\.\.)[ \t]*$/u.test(sourceLine.text)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (fence !== null) {
      if (closesFence(sourceLine.text, fence)) fence = null;
      continue;
    }

    const openedFence = readFence(sourceLine.text);
    if (openedFence !== null) {
      fence = openedFence;
      continue;
    }

    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(sourceLine.text);
    if (match === null) continue;

    const marker = match[1];
    if (marker === undefined) continue;
    const text = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
    headings.push({
      level: marker.length,
      line: sourceLine.line,
      sourceLine: sourceLine.text,
      start: sourceLine.start,
      text,
    });
  }

  const ancestors: Array<Omit<MarkdownHeadingTarget, 'path'>> = [];
  return headings.map((heading) => {
    while ((ancestors.at(-1)?.level ?? 0) >= heading.level) ancestors.pop();
    const path = [...ancestors.map((ancestor) => ancestor.text), heading.text];
    ancestors.push(heading);
    return { ...heading, path };
  });
}

export function resolveHeadingSectionPlacement(
  documentText: string,
  selected: MarkdownHeadingTarget,
): NotePlacementOptions | null {
  const headings = findMarkdownHeadingTargets(documentText);
  const headingIndex = headings.findIndex(
    (candidate) =>
      candidate.start === selected.start &&
      candidate.level === selected.level &&
      candidate.sourceLine === selected.sourceLine,
  );
  if (headingIndex < 0) return null;

  const heading = headings[headingIndex];
  if (heading === undefined) return null;
  const boundary =
    headings.slice(headingIndex + 1).find((candidate) => candidate.level <= heading.level)?.start ??
    documentText.length;

  return {
    anchor: 'section_end',
    position: insertionPositionBeforeBoundary(documentText, boundary),
  };
}

function insertionPositionBeforeBoundary(documentText: string, boundary: number): number {
  if (boundary >= documentText.length) return documentText.length;
  if (boundary >= 2 && documentText.slice(boundary - 2, boundary) === '\r\n') {
    return boundary - 2;
  }
  if (boundary >= 1 && /[\r\n]/u.test(documentText[boundary - 1] ?? '')) {
    return boundary - 1;
  }
  return boundary;
}

function readSourceLines(documentText: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let line = 0;
  let start = 0;

  while (start <= documentText.length) {
    const newline = documentText.indexOf('\n', start);
    const rawEnd = newline < 0 ? documentText.length : newline;
    const end = rawEnd > start && documentText[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    lines.push({ line, start, text: documentText.slice(start, end) });
    if (newline < 0) break;
    start = newline + 1;
    line += 1;
  }

  return lines;
}

function readFence(line: string): { character: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return null;
  const character = marker[0];
  if (character !== '`' && character !== '~') return null;
  return { character, length: marker.length };
}

function closesFence(line: string, fence: { character: '`' | '~'; length: number }): boolean {
  const candidate = line.replace(/^ {0,3}/u, '');
  let markerLength = 0;
  while (candidate[markerLength] === fence.character) markerLength += 1;
  return markerLength >= fence.length && candidate.slice(markerLength).trim().length === 0;
}
