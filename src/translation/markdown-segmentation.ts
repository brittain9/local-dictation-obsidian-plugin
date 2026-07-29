export type TranslationSegment =
  | { kind: 'protected'; text: string }
  | { kind: 'translatable'; protectedSlots: ProtectedSlot[]; text: string };

export interface TranslationRebuildResult {
  /** Units left in the source language because their protected Markdown was lost. */
  sourceUnitsKept: number;
  text: string;
}

type ProtectedMarkerMode = 'private-use' | 'synthetic-url';

interface MarkdownTranslationOptions {
  protectedMarkerMode?: ProtectedMarkerMode;
}

interface ContextualInlinePart {
  kind: 'protected' | 'translatable';
  text: string;
}

type InlinePart = ContextualInlinePart | { kind: 'boundary'; text: string };

interface ProtectedSlot {
  marker: string;
  text: string;
}

const MAX_TRANSLATION_UNIT_CHARACTERS = 2_000;
const MAX_PROTECTED_SLOTS_PER_UNIT = 512;
const PRIVATE_USE_START = 0xe000;
const PRIVATE_USE_END = 0xf8ff;
const SYNTHETIC_URL_MARKER_CHARACTER_BUDGET = '<https://511.invalid>'.length;
const INDENTED_CODE_INDENT = 4;
const STRUCTURAL_PREFIX = /^(\s*(?:>\s*)*(?:(?:#{1,6}|[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)/u;
const BLOCKQUOTE_PREFIX = /^(?: {0,3}(?:> ?)+)*/u;
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d+[.)])([ \t]+)/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const BLOCK_MATH = /^\s*\$\$\s*$/u;
const FRONTMATTER_DELIMITER = /^---\s*$/u;
const HORIZONTAL_RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;

export function segmentMarkdownForTranslation(
  markdown: string,
  options: MarkdownTranslationOptions = {},
): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const markerMode = options.protectedMarkerMode ?? 'private-use';
  const lines = markdown.match(/[^\n]*(?:\n|$)/gu) ?? [];
  let blockFence: string | null = null;
  let inFrontmatter = false;
  let inMathBlock = false;
  let inIndentedCode = false;
  let listContentIndent = 0;
  let previousLineIsBlank = true;

  for (let index = 0; index < lines.length; index += 1) {
    const completeLine = lines[index] ?? '';
    if (completeLine.length === 0) continue;
    const hasNewline = completeLine.endsWith('\n');
    const line = hasNewline ? completeLine.slice(0, -1) : completeLine;
    // Fences, block math, and indented code stay recognizable inside a
    // blockquote, so block scanning runs on the line without its quote markers.
    const quoted = line.slice((line.match(BLOCKQUOTE_PREFIX)?.[0] ?? '').length);
    const isBlank = line.trim().length === 0;

    if (index === 0 && FRONTMATTER_DELIMITER.test(line)) {
      inFrontmatter = true;
      pushProtected(segments, line);
    } else if (inFrontmatter) {
      pushProtected(segments, line);
      if (FRONTMATTER_DELIMITER.test(line)) inFrontmatter = false;
    } else if (blockFence !== null) {
      pushProtected(segments, line);
      if (isClosingFence(quoted, blockFence)) blockFence = null;
    } else if (inMathBlock) {
      pushProtected(segments, line);
      if (BLOCK_MATH.test(quoted)) inMathBlock = false;
    } else {
      const openingFence = quoted.match(FENCE)?.[1];
      if (openingFence !== undefined) {
        blockFence = openingFence;
        pushProtected(segments, line);
      } else if (BLOCK_MATH.test(quoted)) {
        inMathBlock = true;
        pushProtected(segments, line);
      } else if (isBlank || HORIZONTAL_RULE.test(line)) {
        pushProtected(segments, line);
      } else if (
        indentWidth(quoted) >= listContentIndent + INDENTED_CODE_INDENT &&
        (inIndentedCode || previousLineIsBlank)
      ) {
        inIndentedCode = true;
        pushProtected(segments, line);
      } else {
        inIndentedCode = false;
        listContentIndent = nextListContentIndent(quoted, listContentIndent);
        segmentInlineMarkdown(line, segments, markerMode);
      }
    }

    previousLineIsBlank = isBlank;
    if (hasNewline) pushProtected(segments, '\n');
  }
  return segments;
}

export function translatableTexts(segments: readonly TranslationSegment[]): string[] {
  return segments
    .filter(
      (segment): segment is Extract<TranslationSegment, { kind: 'translatable' }> =>
        segment.kind === 'translatable',
    )
    .map((segment) => segment.text);
}

export function protectedMarkerModeForLanguages(
  sourceLanguage: string,
  targetLanguage: string,
): ProtectedMarkerMode {
  return sourceLanguage === 'ja' || targetLanguage === 'ja' ? 'synthetic-url' : 'private-use';
}

export function rebuildTranslatedMarkdown(
  segments: readonly TranslationSegment[],
  translations: readonly string[],
): TranslationRebuildResult {
  let translationIndex = 0;
  let sourceUnitsKept = 0;
  const text = segments
    .map((segment) => {
      if (segment.kind === 'protected') return segment.text;
      const translation = translations[translationIndex];
      translationIndex += 1;
      if (translation === undefined) {
        throw new Error('The translation runtime returned too few translated sections.');
      }
      // A unit whose protected Markdown came back missing, duplicated, or
      // reordered cannot be rebuilt safely. Keeping that one unit in the source
      // language preserves the note instead of discarding the whole translation.
      if (!hasIntactProtectedSlots(translation, segment.protectedSlots)) {
        sourceUnitsKept += 1;
        return restoreProtectedSlots(segment.text, segment.protectedSlots);
      }
      return restoreProtectedSlots(translation, segment.protectedSlots);
    })
    .join('');
  if (translationIndex !== translations.length) {
    throw new Error('The translation runtime returned too many translated sections.');
  }
  return { sourceUnitsKept, text };
}

function segmentInlineMarkdown(
  line: string,
  segments: TranslationSegment[],
  markerMode: ProtectedMarkerMode,
): void {
  const prefix = line.match(STRUCTURAL_PREFIX)?.[1] ?? '';
  if (prefix.length > 0) pushProtected(segments, prefix);

  const remainder = line.slice(prefix.length);
  const trailing = remainder.match(/\s+$/u)?.[0] ?? '';
  const body = trailing.length === 0 ? remainder : remainder.slice(0, -trailing.length);
  const parts = tokenizeInlineMarkdown(body);
  let contextualParts: ContextualInlinePart[] = [];
  let followsBoundary = false;
  const flushContextualParts = (): void => {
    for (const unit of chunkInlineParts(contextualParts, markerMode)) {
      pushTranslationUnit(segments, unit, markerMode);
    }
    contextualParts = [];
  };
  for (const part of parts) {
    if (part.kind === 'boundary') {
      flushContextualParts();
      pushProtected(segments, part.text);
      followsBoundary = true;
    } else {
      if (followsBoundary && part.kind === 'translatable') {
        const separator = part.text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
        pushProtected(segments, separator);
        const prose = part.text.slice(separator.length);
        if (prose.length > 0) contextualParts.push({ kind: 'translatable', text: prose });
      } else {
        contextualParts.push(part);
      }
      followsBoundary = false;
    }
  }
  flushContextualParts();
  pushProtected(segments, trailing);
}

function tokenizeInlineMarkdown(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let remaining = value;
  while (remaining.length > 0) {
    const link = remaining.match(/^(!?)\[([^\]]*)\]\(([^)\n]*)\)/u);
    if (link !== null) {
      const whole = link[0];
      const imageMarker = link[1] ?? '';
      const label = link[2] ?? '';
      const destination = link[3] ?? '';
      pushPart(parts, imageMarker.length > 0 ? 'protected' : 'boundary', `${imageMarker}[`);
      pushPart(parts, imageMarker.length > 0 ? 'protected' : 'translatable', label);
      pushPart(parts, imageMarker.length > 0 ? 'protected' : 'boundary', `](${destination})`);
      remaining = remaining.slice(whole.length);
      continue;
    }

    const boundaryToken = remaining.match(/^(?:\*\*|__|~~|==|\*|_|\|)/u)?.[0];
    if (boundaryToken !== undefined) {
      pushPart(parts, 'boundary', boundaryToken);
      remaining = remaining.slice(boundaryToken.length);
      continue;
    }

    const protectedToken = matchProtectedToken(remaining);
    if (protectedToken !== null) {
      pushPart(parts, 'protected', protectedToken);
      remaining = remaining.slice(protectedToken.length);
      continue;
    }

    const nextProtectedIndex = findNextProtectedIndex(remaining);
    const length = nextProtectedIndex <= 0 ? 1 : nextProtectedIndex;
    pushPart(parts, 'translatable', remaining.slice(0, length));
    remaining = remaining.slice(length);
  }
  return parts;
}

function chunkInlineParts(
  parts: readonly ContextualInlinePart[],
  markerMode: ProtectedMarkerMode,
): ContextualInlinePart[][] {
  const chunks: ContextualInlinePart[][] = [];
  let current: ContextualInlinePart[] = [];
  let currentCharacters = 0;
  let currentProtectedSlots = 0;

  const flush = (): void => {
    if (current.length > 0) chunks.push(current);
    current = [];
    currentCharacters = 0;
    currentProtectedSlots = 0;
  };

  for (const part of parts) {
    if (part.kind === 'protected') {
      if (
        currentProtectedSlots >= MAX_PROTECTED_SLOTS_PER_UNIT ||
        currentCharacters >= MAX_TRANSLATION_UNIT_CHARACTERS
      ) {
        flush();
      }
      pushPart(current, part.kind, part.text);
      currentProtectedSlots += 1;
      currentCharacters +=
        markerMode === 'synthetic-url' ? SYNTHETIC_URL_MARKER_CHARACTER_BUDGET : 1;
      continue;
    }

    let remaining = part.text;
    while (remaining.length > 0) {
      const capacity = MAX_TRANSLATION_UNIT_CHARACTERS - currentCharacters;
      if (capacity <= 0) {
        flush();
        continue;
      }
      if (remaining.length <= capacity) {
        pushPart(current, part.kind, remaining);
        currentCharacters += remaining.length;
        break;
      }
      const splitAt = translationBreak(remaining, capacity);
      pushPart(current, part.kind, remaining.slice(0, splitAt));
      currentCharacters += splitAt;
      remaining = remaining.slice(splitAt);
      flush();
    }
  }
  flush();
  return chunks;
}

function pushTranslationUnit(
  segments: TranslationSegment[],
  parts: readonly ContextualInlinePart[],
  markerMode: ProtectedMarkerMode,
): void {
  if (!parts.some((part) => part.kind === 'translatable' && /[\p{L}\p{N}]/u.test(part.text))) {
    pushProtected(segments, parts.map((part) => part.text).join(''));
    return;
  }

  const protectedSlots: ProtectedSlot[] = [];
  const sourceText = parts.map((part) => part.text).join('');
  const usedMarkers = new Set<string>();
  const text = parts
    .map((part) => {
      if (part.kind === 'translatable') return part.text;
      const marker = nextProtectedMarker(sourceText, usedMarkers, markerMode);
      usedMarkers.add(marker);
      protectedSlots.push({ marker, text: part.text });
      return marker;
    })
    .join('');
  segments.push({ kind: 'translatable', protectedSlots, text });
}

function hasIntactProtectedSlots(
  translation: string,
  protectedSlots: readonly ProtectedSlot[],
): boolean {
  let previousMarkerIndex = -1;
  for (const slot of protectedSlots) {
    const markerIndex = translation.indexOf(slot.marker);
    if (
      markerIndex <= previousMarkerIndex ||
      translation.indexOf(slot.marker, markerIndex + slot.marker.length) >= 0
    ) {
      return false;
    }
    previousMarkerIndex = markerIndex;
  }
  return true;
}

function restoreProtectedSlots(
  translation: string,
  protectedSlots: readonly ProtectedSlot[],
): string {
  return protectedSlots.reduce(
    (restored, slot) => restored.replace(slot.marker, () => slot.text),
    translation,
  );
}

function matchProtectedToken(value: string): string | null {
  const patterns = [
    /^\[![\p{L}\p{N}_-]+[+-]?\]/u,
    /^!?\[\[[^\]\n]+\]\]/u,
    /^(`+)[\s\S]*?\1/u,
    /^\$\$[^$\n]+?\$\$/u,
    /^\$[^$\n]+\$/u,
    /^https?:\/\/[^\s<>()]+/u,
    /^<[^>\n]+>/u,
    /^#[\p{L}\p{N}_/-]+/u,
    /^(?:\\[\\`*_[\]{}()#+\-.!>])/u,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[0];
    if (match !== undefined) return match;
  }
  return null;
}

function findNextProtectedIndex(value: string): number {
  const candidates = [
    '[[',
    '![',
    '[',
    '`',
    '$',
    'http://',
    'https://',
    '<',
    '#',
    '*',
    '_',
    '~',
    '=',
    '|',
    '\\',
  ];
  let index = value.length;
  for (const candidate of candidates) {
    const candidateIndex = value.indexOf(candidate, 1);
    if (candidateIndex >= 0 && candidateIndex < index) index = candidateIndex;
  }
  return index;
}

function indentWidth(line: string): number {
  const indent = line.match(/^[ \t]*/u)?.[0] ?? '';
  return [...indent].reduce((width, character) => width + (character === '\t' ? 4 : 1), 0);
}

// A list item shifts the column at which indented code starts, so continuation
// lines inside a list stay prose instead of being mistaken for a code block.
function nextListContentIndent(line: string, currentIndent: number): number {
  const marker = line.match(LIST_MARKER);
  if (marker !== null) {
    return marker[0].length - (marker[1] ?? '').length + indentWidth(marker[1] ?? '');
  }
  return indentWidth(line) < currentIndent ? 0 : currentIndent;
}

function isClosingFence(line: string, openingFence: string): boolean {
  const fenceCharacter = openingFence[0];
  if (fenceCharacter !== '`' && fenceCharacter !== '~') return false;
  return new RegExp(`^ {0,3}${fenceCharacter}{${openingFence.length},}\\s*$`, 'u').test(line);
}

function translationBreak(value: string, capacity: number): number {
  if (capacity <= 0) return 1;
  const candidate = value.slice(0, capacity);
  const sentenceBreak = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('! '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('。'),
  );
  if (sentenceBreak >= Math.floor(capacity / 2)) return sentenceBreak + 1;
  const whitespaceBreak = candidate.search(/\s+\S*$/u);
  return whitespaceBreak > 0 ? whitespaceBreak : capacity;
}

function nextProtectedMarker(
  sourceText: string,
  usedMarkers: ReadonlySet<string>,
  markerMode: ProtectedMarkerMode,
): string {
  if (markerMode === 'private-use') {
    for (let codePoint = PRIVATE_USE_START; codePoint <= PRIVATE_USE_END; codePoint += 1) {
      const marker = String.fromCodePoint(codePoint);
      if (!sourceText.includes(marker) && !usedMarkers.has(marker)) return marker;
    }
    throw new Error('The source text uses every available protected Markdown marker.');
  }
  for (let index = 0; index < MAX_PROTECTED_SLOTS_PER_UNIT; index += 1) {
    const marker = `<https://${index}.invalid>`;
    if (!sourceText.includes(marker) && !usedMarkers.has(marker)) return marker;
  }
  throw new Error('The source text uses every available protected Markdown marker.');
}

function pushPart(parts: InlinePart[], kind: InlinePart['kind'], text: string): void {
  if (text.length === 0) return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
  } else {
    parts.push({ kind, text });
  }
}

function pushProtected(segments: TranslationSegment[], text: string): void {
  if (text.length === 0) return;
  const previous = segments.at(-1);
  if (previous?.kind === 'protected') {
    previous.text += text;
  } else {
    segments.push({ kind: 'protected', text });
  }
}
