export type TranslationSegment =
  | { kind: 'protected'; text: string }
  | { kind: 'translatable'; text: string };

const STRUCTURAL_PREFIX = /^(\s*(?:>\s*)*(?:(?:#{1,6}|[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)/u;
const FENCE = /^\s*(`{3,}|~{3,})/u;
const BLOCK_MATH = /^\s*\$\$\s*$/u;
const FRONTMATTER_DELIMITER = /^---\s*$/u;
const HORIZONTAL_RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;

export function segmentMarkdownForTranslation(markdown: string): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const lines = markdown.match(/[^\n]*(?:\n|$)/gu) ?? [];
  let blockFence: string | null = null;
  let inFrontmatter = false;
  let inMathBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const completeLine = lines[index] ?? '';
    if (completeLine.length === 0) continue;
    const hasNewline = completeLine.endsWith('\n');
    const line = hasNewline ? completeLine.slice(0, -1) : completeLine;

    if (index === 0 && FRONTMATTER_DELIMITER.test(line)) {
      inFrontmatter = true;
      pushSegment(segments, 'protected', line);
    } else if (inFrontmatter) {
      pushSegment(segments, 'protected', line);
      if (FRONTMATTER_DELIMITER.test(line)) inFrontmatter = false;
    } else if (blockFence !== null) {
      pushSegment(segments, 'protected', line);
      const closingFence = line.match(FENCE)?.[1];
      if (closingFence?.startsWith(blockFence[0] ?? '') === true) blockFence = null;
    } else if (inMathBlock) {
      pushSegment(segments, 'protected', line);
      if (BLOCK_MATH.test(line)) inMathBlock = false;
    } else {
      const openingFence = line.match(FENCE)?.[1];
      if (openingFence !== undefined) {
        blockFence = openingFence;
        pushSegment(segments, 'protected', line);
      } else if (BLOCK_MATH.test(line)) {
        inMathBlock = true;
        pushSegment(segments, 'protected', line);
      } else if (line.trim().length === 0 || HORIZONTAL_RULE.test(line)) {
        pushSegment(segments, 'protected', line);
      } else {
        segmentInlineMarkdown(line, segments);
      }
    }

    if (hasNewline) pushSegment(segments, 'protected', '\n');
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

export function rebuildTranslatedMarkdown(
  segments: readonly TranslationSegment[],
  translations: readonly string[],
): string {
  let translationIndex = 0;
  const output = segments
    .map((segment) => {
      if (segment.kind === 'protected') return segment.text;
      const translation = translations[translationIndex];
      translationIndex += 1;
      if (translation === undefined) {
        throw new Error('The translation runtime returned too few translated sections.');
      }
      return translation;
    })
    .join('');
  if (translationIndex !== translations.length) {
    throw new Error('The translation runtime returned too many translated sections.');
  }
  return output;
}

function segmentInlineMarkdown(line: string, segments: TranslationSegment[]): void {
  const prefix = line.match(STRUCTURAL_PREFIX)?.[1] ?? '';
  if (prefix.length > 0) pushSegment(segments, 'protected', prefix);
  let remaining = line.slice(prefix.length);

  while (remaining.length > 0) {
    const link = remaining.match(/^(!?)\[([^\]]*)\]\(([^)\n]*)\)/u);
    if (link !== null) {
      const whole = link[0];
      const imageMarker = link[1] ?? '';
      const label = link[2] ?? '';
      const destination = link[3] ?? '';
      pushSegment(segments, 'protected', `${imageMarker}[`);
      if (imageMarker.length > 0) {
        pushSegment(segments, 'protected', label);
      } else {
        pushTranslatable(segments, label);
      }
      pushSegment(segments, 'protected', `](${destination})`);
      remaining = remaining.slice(whole.length);
      continue;
    }

    const protectedToken = matchProtectedToken(remaining);
    if (protectedToken !== null) {
      pushSegment(segments, 'protected', protectedToken);
      remaining = remaining.slice(protectedToken.length);
      continue;
    }

    const nextProtectedIndex = findNextProtectedIndex(remaining);
    const length = nextProtectedIndex <= 0 ? 1 : nextProtectedIndex;
    pushTranslatable(segments, remaining.slice(0, length));
    remaining = remaining.slice(length);
  }
}

function matchProtectedToken(value: string): string | null {
  const patterns = [
    /^\[![\p{L}\p{N}_-]+[+-]?\]/u,
    /^!?\[\[[^\]\n]+\]\]/u,
    /^(`+)[\s\S]*?\1/u,
    /^\$[^$\n]+\$/u,
    /^https?:\/\/[^\s<>()]+/u,
    /^<[^>\n]+>/u,
    /^#[\p{L}\p{N}_/-]+/u,
    /^(?:\*\*|__|~~|==|\*|_|\||\\[\\`*_[\]{}()#+\-.!>])/u,
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

function pushTranslatable(segments: TranslationSegment[], text: string): void {
  if (text.trim().length === 0) {
    pushSegment(segments, 'protected', text);
    return;
  }
  const leading = text.match(/^\s*/u)?.[0] ?? '';
  const trailing = text.match(/\s*$/u)?.[0] ?? '';
  const body = text.slice(leading.length, text.length - trailing.length);
  pushSegment(segments, 'protected', leading);
  if (/[\p{L}\p{N}]/u.test(body)) {
    pushSegment(segments, 'translatable', body);
  } else {
    pushSegment(segments, 'protected', body);
  }
  pushSegment(segments, 'protected', trailing);
}

function pushSegment(
  segments: TranslationSegment[],
  kind: TranslationSegment['kind'],
  text: string,
): void {
  if (text.length === 0) return;
  const previous = segments.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  segments.push({ kind, text });
}
