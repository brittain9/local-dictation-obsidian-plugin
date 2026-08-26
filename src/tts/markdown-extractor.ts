import type { SourceRange, SynthesisTextChunk } from '../sidecar/protocol';

interface MappedText {
  sourceOffsets: number[];
  text: string;
}

const FENCE_PATTERN = /^\s*(```|~~~)/u;
const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/u;
const LIST_MARKER_PATTERN = /^\s*(?:[-+*]|\d+[.)])\s+/u;
const BLOCKQUOTE_PATTERN = /^\s*>\s?/u;
const TABLE_DIVIDER_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u;

/** Extracts text for speech while retaining source-character offsets. */
export function extractSpeakableMarkdown(source: string): MappedText {
  const output: string[] = [];
  const sourceOffsets: number[] = [];
  let inFence: string | null = null;
  let inMathBlock = false;
  let offset = 0;

  const lines = source.split(/(?<=\n)/u);
  let inFrontmatter = source.startsWith('---\n') || source === '---';

  for (const lineWithEnding of lines) {
    const line = lineWithEnding.replace(/\r?\n$/u, '');
    const newlineLength = lineWithEnding.length - line.length;

    if (inFrontmatter) {
      if (offset > 0 && /^(?:---|\.\.\.)\s*$/u.test(line)) {
        inFrontmatter = false;
      }
      offset += lineWithEnding.length;
      continue;
    }

    const fence = line.match(FENCE_PATTERN)?.[1] ?? null;
    if (inFence !== null) {
      if (fence === inFence) inFence = null;
      offset += lineWithEnding.length;
      continue;
    }
    if (fence !== null) {
      inFence = fence;
      offset += lineWithEnding.length;
      continue;
    }

    if (TABLE_DIVIDER_PATTERN.test(line)) {
      offset += lineWithEnding.length;
      continue;
    }

    const prefixLength = Math.max(
      line.match(HEADING_PATTERN)?.[0].length ?? 0,
      line.match(LIST_MARKER_PATTERN)?.[0].length ?? 0,
      line.match(BLOCKQUOTE_PATTERN)?.[0].length ?? 0,
    );
    inMathBlock = appendWithoutDisplayMath(
      line.slice(prefixLength),
      offset + prefixLength,
      inMathBlock,
      output,
      sourceOffsets,
    );

    if (newlineLength > 0 && output.length > 0) {
      output.push('\n');
      sourceOffsets.push(offset + line.length);
    }
    offset += lineWithEnding.length;
  }

  return normalizeMappedText(output, sourceOffsets);
}

function appendWithoutDisplayMath(
  line: string,
  baseOffset: number,
  startsInsideMath: boolean,
  output: string[],
  sourceOffsets: number[],
): boolean {
  let inMath = startsInsideMath;
  let cursor = 0;
  while (cursor < line.length) {
    if (inMath) {
      const close = line.indexOf('$$', cursor);
      if (close < 0) return true;
      inMath = false;
      cursor = close + 2;
      continue;
    }
    const open = line.indexOf('$$', cursor);
    if (open < 0) {
      appendInline(line.slice(cursor), baseOffset + cursor, output, sourceOffsets);
      return false;
    }
    appendInline(line.slice(cursor, open), baseOffset + cursor, output, sourceOffsets);
    inMath = true;
    cursor = open + 2;
  }
  return inMath;
}

function appendInline(
  line: string,
  baseOffset: number,
  output: string[],
  sourceOffsets: number[],
): void {
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    const wiki = rest.match(/^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/u);
    if (wiki !== null) {
      const label = (wiki[2] ?? wiki[1] ?? '').trim();
      appendLabel(label, baseOffset + index + wiki[0].indexOf(label), output, sourceOffsets);
      index += wiki[0].length;
      continue;
    }

    const markdownLink = rest.match(/^!?\[([^\]]*)\]\([^)]*\)/u);
    if (markdownLink !== null) {
      const label = (markdownLink[1] ?? '').trim();
      appendLabel(
        label,
        baseOffset + index + markdownLink[0].indexOf(label),
        output,
        sourceOffsets,
      );
      index += markdownLink[0].length;
      continue;
    }

    const code = rest.match(/^`+[^`]*`+/u);
    if (code !== null) {
      index += code[0].length;
      continue;
    }

    const math = rest.match(/^\$(?!\$)[^$]*\$/u);
    if (math !== null) {
      index += math[0].length;
      continue;
    }

    const char = line[index] ?? '';
    if ('*_~|'.includes(char) || (char === '#' && index > 0)) {
      index += 1;
      continue;
    }
    output.push(char);
    sourceOffsets.push(baseOffset + index);
    index += 1;
  }
}

function appendLabel(
  label: string,
  sourceOffset: number,
  output: string[],
  sourceOffsets: number[],
): void {
  for (let index = 0; index < label.length; index += 1) {
    output.push(label[index] ?? '');
    sourceOffsets.push(sourceOffset + index);
  }
}

function normalizeMappedText(chars: string[], offsets: number[]): MappedText {
  const output: string[] = [];
  const sourceOffsets: number[] = [];
  let pendingSpaceOffset: number | null = null;
  let pendingNewlineCount = 0;
  let pendingNewlineOffset: number | null = null;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? '';
    const offset = offsets[index] ?? 0;
    if (char === '\n') {
      pendingNewlineCount += 1;
      pendingNewlineOffset ??= offset;
      continue;
    }
    if (/\s/u.test(char)) {
      pendingSpaceOffset ??= offset;
      continue;
    }
    if (output.length > 0) {
      if (pendingNewlineCount >= 2) {
        output.push('\n', '\n');
        sourceOffsets.push(pendingNewlineOffset ?? offset, pendingNewlineOffset ?? offset);
      } else if (pendingSpaceOffset !== null || pendingNewlineCount === 1) {
        output.push(' ');
        sourceOffsets.push(pendingSpaceOffset ?? pendingNewlineOffset ?? offset);
      }
    }
    pendingSpaceOffset = null;
    pendingNewlineCount = 0;
    pendingNewlineOffset = null;
    output.push(char);
    sourceOffsets.push(offset);
  }

  return { sourceOffsets, text: output.join('') };
}

export function segmentSpeakableText(
  mapped: MappedText,
  options: { locale?: string; maximumCharacters?: number; minimumCharacters?: number } = {},
): SynthesisTextChunk[] {
  const minimumCharacters = options.minimumCharacters ?? 1;
  const maximumCharacters = options.maximumCharacters ?? 300;
  const chunks: SynthesisTextChunk[] = [];
  const paragraphBreak = /\n{2,}/gu;
  let paragraphStart = 0;
  for (const match of mapped.text.matchAll(paragraphBreak)) {
    const paragraphEnd = match.index ?? paragraphStart;
    appendSegmentedRange(
      mapped,
      paragraphStart,
      paragraphEnd,
      options.locale,
      minimumCharacters,
      maximumCharacters,
      chunks,
    );
    paragraphStart = paragraphEnd + match[0].length;
  }
  appendSegmentedRange(
    mapped,
    paragraphStart,
    mapped.text.length,
    options.locale,
    minimumCharacters,
    maximumCharacters,
    chunks,
  );
  return chunks;
}

function appendSegmentedRange(
  mapped: MappedText,
  rangeStart: number,
  rangeEnd: number,
  locale: string | undefined,
  minimumCharacters: number,
  maximumCharacters: number,
  chunks: SynthesisTextChunk[],
): void {
  if (rangeEnd <= rangeStart) return;
  const text = mapped.text.slice(rangeStart, rangeEnd);
  const segmenter = new Intl.Segmenter(locale ?? 'en', { granularity: 'sentence' });
  const sentences = [...segmenter.segment(text)].flatMap((sentence) =>
    splitLongSentence(text, sentence.index, sentence.segment.length, maximumCharacters),
  );
  let start = 0;
  let end = 0;

  const flush = (): void => {
    const trimmed = mapped.text.slice(rangeStart + start, rangeStart + end).trim();
    if (trimmed.length === 0) return;
    const first = mapped.text.indexOf(trimmed, rangeStart + start);
    const last = first + trimmed.length - 1;
    const sourceStart = mapped.sourceOffsets[first];
    const sourceEnd = mapped.sourceOffsets[last];
    if (sourceStart === undefined || sourceEnd === undefined) return;
    chunks.push({
      sourceRange: { from: sourceStart, to: sourceEnd + 1 },
      text: trimmed,
    });
  };

  for (const sentence of sentences) {
    if (end > start && sentence.index + sentence.segment.length - start > maximumCharacters) {
      flush();
      start = end;
    }
    if (end === start) start = sentence.index;
    end = sentence.index + sentence.segment.length;
    if (end - start >= minimumCharacters) {
      flush();
      start = end;
    }
  }
  if (end > start) flush();
}

function splitLongSentence(
  text: string,
  sentenceStart: number,
  sentenceLength: number,
  maximumCharacters: number,
): Array<{ index: number; segment: string }> {
  const pieces: Array<{ index: number; segment: string }> = [];
  const sentenceEnd = sentenceStart + sentenceLength;
  let start = sentenceStart;
  while (sentenceEnd - start > maximumCharacters) {
    const window = text.slice(start, start + maximumCharacters + 1);
    const whitespace = window.lastIndexOf(' ');
    const end = whitespace > 0 ? start + whitespace + 1 : start + maximumCharacters;
    pieces.push({ index: start, segment: text.slice(start, end) });
    start = end;
  }
  pieces.push({ index: start, segment: text.slice(start, sentenceEnd) });
  return pieces;
}

export function extractAndSegmentMarkdown(
  source: string,
  sourceRange: SourceRange = { from: 0, to: source.length },
  options: { locale?: string } = {},
): SynthesisTextChunk[] {
  const sliced = source.slice(sourceRange.from, sourceRange.to);
  const mapped = extractSpeakableMarkdown(sliced);
  return segmentSpeakableText(
    {
      sourceOffsets: mapped.sourceOffsets.map((offset) => offset + sourceRange.from),
      text: mapped.text,
    },
    options,
  );
}
