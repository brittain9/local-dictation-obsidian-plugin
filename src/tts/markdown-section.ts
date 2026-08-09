interface MarkdownHeading {
  from: number;
  level: number;
}

interface MarkdownLine {
  from: number;
  text: string;
}

interface MarkdownFence {
  character: '`' | '~';
  length: number;
}

const ATX_HEADING_PATTERN = /^ {0,3}(#{1,6})(?:[\t ]+|$)/u;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const SETEXT_HEADING_PATTERN = /^ {0,3}(=+|-+)[\t ]*$/u;
const SETEXT_TEXT_EXCLUSION_PATTERN =
  /^(?: {4}|\t| {0,3}(?:#(?:[\t ]+|$)|>|[-+*](?:[\t ]+|$)|\d+[.)](?:[\t ]+|$)))/u;

/** Resolves the document section containing a source offset. */
export function resolveCurrentSectionRange(
  source: string,
  cursorOffset: number,
): { from: number; to: number } {
  const headings = findMarkdownHeadings(source);
  const cursor = Math.max(0, Math.min(cursorOffset, source.length));
  let current: MarkdownHeading | undefined;

  for (const heading of headings) {
    if (heading.from > cursor) break;
    current = heading;
  }

  if (current === undefined) {
    return { from: 0, to: headings[0]?.from ?? source.length };
  }

  const nextBoundary = headings.find(
    (heading) => heading.from > current.from && heading.level <= current.level,
  );
  return { from: current.from, to: nextBoundary?.from ?? source.length };
}

function findMarkdownHeadings(source: string): MarkdownHeading[] {
  const lines = splitMarkdownLines(source);
  const headings: MarkdownHeading[] = [];
  let fence: MarkdownFence | null = null;
  let inFrontmatter = lines[0]?.text === '---';
  let setextCandidateFrom: number | null = null;

  for (const [index, line] of lines.entries()) {
    if (inFrontmatter) {
      if (index > 0 && /^(?:---|\.\.\.)[\t ]*$/u.test(line.text)) {
        inFrontmatter = false;
      }
      setextCandidateFrom = null;
      continue;
    }

    const fenceMatch = line.text.match(FENCE_PATTERN);
    if (fence !== null) {
      if (fenceMatch !== null && isClosingFence(fence, fenceMatch)) fence = null;
      setextCandidateFrom = null;
      continue;
    }
    if (fenceMatch !== null && isOpeningFence(fenceMatch)) {
      const marker = fenceMatch[1] ?? '';
      fence = {
        character: marker[0] as '`' | '~',
        length: marker.length,
      };
      setextCandidateFrom = null;
      continue;
    }

    const atx = line.text.match(ATX_HEADING_PATTERN)?.[1];
    if (atx !== undefined) {
      headings.push({ from: line.from, level: atx.length });
      setextCandidateFrom = null;
      continue;
    }

    const setext = line.text.match(SETEXT_HEADING_PATTERN)?.[1];
    if (setext !== undefined && setextCandidateFrom !== null) {
      headings.push({
        from: setextCandidateFrom,
        level: setext[0] === '=' ? 1 : 2,
      });
      setextCandidateFrom = null;
      continue;
    }

    if (isSetextHeadingText(line.text)) {
      setextCandidateFrom ??= line.from;
    } else {
      setextCandidateFrom = null;
    }
  }

  return headings;
}

function splitMarkdownLines(source: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let from = 0;
  while (from <= source.length) {
    const newline = source.indexOf('\n', from);
    const to = newline < 0 ? source.length : newline;
    const contentTo = to > from && source[to - 1] === '\r' ? to - 1 : to;
    lines.push({ from, text: source.slice(from, contentTo) });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function isOpeningFence(match: RegExpMatchArray): boolean {
  const marker = match[1] ?? '';
  const info = match[2] ?? '';
  return !marker.startsWith('`') || !info.includes('`');
}

function isClosingFence(fence: MarkdownFence, match: RegExpMatchArray): boolean {
  const marker = match[1] ?? '';
  const suffix = match[2] ?? '';
  return marker[0] === fence.character && marker.length >= fence.length && /^[\t ]*$/u.test(suffix);
}

function isSetextHeadingText(line: string): boolean {
  return line.trim().length > 0 && !SETEXT_TEXT_EXCLUSION_PATTERN.test(line);
}
