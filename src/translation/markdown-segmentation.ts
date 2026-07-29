export type TranslationSegment =
  | { kind: 'protected'; text: string }
  | { html: string; kind: 'translatable'; rebuild: SegmentRebuild };

export interface TranslationRebuildResult {
  sourceUnitsKept: 0;
  text: string;
}

interface WrapperRestoration {
  closeMarkdown: string;
  id: number;
  kind: 'wrapper';
  openMarkdown: string;
  tagName: string;
}

interface OpaqueRestoration {
  id: number;
  kind: 'opaque';
  markdown: string;
  tagName: 'span';
}

type MarkdownRestoration = OpaqueRestoration | WrapperRestoration;

interface WrapperSyntax {
  closeMarkdown: string;
  openMarkdown: string;
  tagName: string;
}

interface InlineRebuild {
  kind: 'inline';
  restorations: MarkdownRestoration[];
}

interface TableCellRestoration {
  html: string;
  id: number;
  restorations: MarkdownRestoration[];
}

type TableRowPart =
  | { kind: 'cell'; cellId: number; leading: string; trailing: string }
  | { kind: 'literal'; text: string };

interface TableRowRebuild {
  cells: TableCellRestoration[];
  kind: 'table-row';
  parts: TableRowPart[];
}

type SegmentRebuild = InlineRebuild | TableRowRebuild;

interface RenderedInline {
  hasTranslatableText: boolean;
  html: string;
}

const INDENTED_CODE_INDENT = 4;
const STRUCTURAL_PREFIX = /^(\s*(?:>\s*)*(?:(?:#{1,6}|[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)/u;
const BLOCKQUOTE_PREFIX = /^(?: {0,3}(?:> ?)+)*/u;
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d+[.)])([ \t]+)/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const BLOCK_MATH = /^\s*\$\$\s*$/u;
const FRONTMATTER_DELIMITER = /^---\s*$/u;
const HORIZONTAL_RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;
const TABLE_DELIMITER_CELL = /^\s*:?-{3,}:?\s*$/u;
const GENERATED_TAG = /<(\/?)([A-Za-z][\w:-]*)([^>]*)>/gu;
const RESTORATION_ATTRIBUTE = /\bdata-md\s*=\s*["'](\d+)["']/u;
const TABLE_CELL_TAG = /<output\b([^>]*)>([\s\S]*?)<\/output\s*>/giu;
const TABLE_CELL_ATTRIBUTE = /\bdata-table-cell\s*=\s*["'](\d+)["']/u;

const DELIMITED_MARKUP: ReadonlyArray<{
  closeMarkdown: string;
  openMarkdown: string;
  wrappers: readonly WrapperSyntax[];
}> = [
  {
    closeMarkdown: '***',
    openMarkdown: '***',
    wrappers: [
      { closeMarkdown: '**', openMarkdown: '**', tagName: 'strong' },
      { closeMarkdown: '*', openMarkdown: '*', tagName: 'em' },
    ],
  },
  {
    closeMarkdown: '___',
    openMarkdown: '___',
    wrappers: [
      { closeMarkdown: '__', openMarkdown: '__', tagName: 'strong' },
      { closeMarkdown: '_', openMarkdown: '_', tagName: 'em' },
    ],
  },
  {
    closeMarkdown: '**',
    openMarkdown: '**',
    wrappers: [{ closeMarkdown: '**', openMarkdown: '**', tagName: 'strong' }],
  },
  {
    closeMarkdown: '__',
    openMarkdown: '__',
    wrappers: [{ closeMarkdown: '__', openMarkdown: '__', tagName: 'strong' }],
  },
  {
    closeMarkdown: '~~',
    openMarkdown: '~~',
    wrappers: [{ closeMarkdown: '~~', openMarkdown: '~~', tagName: 'del' }],
  },
  {
    closeMarkdown: '==',
    openMarkdown: '==',
    wrappers: [{ closeMarkdown: '==', openMarkdown: '==', tagName: 'mark' }],
  },
  {
    closeMarkdown: '*',
    openMarkdown: '*',
    wrappers: [{ closeMarkdown: '*', openMarkdown: '*', tagName: 'em' }],
  },
  {
    closeMarkdown: '_',
    openMarkdown: '_',
    wrappers: [{ closeMarkdown: '_', openMarkdown: '_', tagName: 'em' }],
  },
];
const CODE_LIKE_HTML_TAGS = new Set(['code', 'kbd', 'pre', 'samp', 'script', 'style']);
const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export function segmentMarkdownForTranslation(markdown: string): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const lines = markdown.match(/[^\n]*(?:\n|$)/gu) ?? [];
  let blockFence: string | null = null;
  let inFrontmatter = false;
  let inMathBlock = false;
  let inIndentedCode = false;
  let inTable = false;
  let listContentIndent = 0;
  let previousLineIsBlank = true;

  for (let index = 0; index < lines.length; index += 1) {
    const completeLine = lines[index] ?? '';
    if (completeLine.length === 0) continue;
    const hasNewline = completeLine.endsWith('\n');
    const line = hasNewline ? completeLine.slice(0, -1) : completeLine;
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
        inTable = false;
        blockFence = openingFence;
        pushProtected(segments, line);
      } else if (BLOCK_MATH.test(quoted)) {
        inTable = false;
        inMathBlock = true;
        pushProtected(segments, line);
      } else if (isBlank || HORIZONTAL_RULE.test(line)) {
        inTable = false;
        pushProtected(segments, line);
      } else if (
        indentWidth(quoted) >= listContentIndent + INDENTED_CODE_INDENT &&
        (inIndentedCode || previousLineIsBlank)
      ) {
        inTable = false;
        inIndentedCode = true;
        pushProtected(segments, line);
      } else {
        inIndentedCode = false;
        const nextQuoted = quotedLineAt(lines, index + 1);
        const startsTable =
          tableSeparatorIndexes(quoted).length > 0 && isTableDelimiterRow(nextQuoted);
        if (inTable && isTableDelimiterRow(quoted)) {
          pushProtected(segments, line);
        } else if (startsTable || (inTable && tableSeparatorIndexes(quoted).length > 0)) {
          inTable = true;
          segmentTableRow(line, line.length - quoted.length, segments);
        } else {
          inTable = false;
          listContentIndent = nextListContentIndent(quoted, listContentIndent);
          segmentInlineMarkdown(line, segments);
        }
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
    .map((segment) => segment.html);
}

export function rebuildTranslatedMarkdown(
  segments: readonly TranslationSegment[],
  translations: readonly string[],
): TranslationRebuildResult {
  let translationIndex = 0;
  const text = segments
    .map((segment) => {
      if (segment.kind === 'protected') return segment.text;
      const translation = translations[translationIndex];
      translationIndex += 1;
      if (translation === undefined) {
        throw new Error('The translation runtime returned too few translated sections.');
      }
      return segment.rebuild.kind === 'inline'
        ? restoreMarkdown(translation, segment.rebuild.restorations)
        : restoreTableRow(translation, segment.rebuild);
    })
    .join('');
  if (translationIndex !== translations.length) {
    throw new Error('The translation runtime returned too many translated sections.');
  }
  return { sourceUnitsKept: 0, text };
}

function segmentInlineMarkdown(line: string, segments: TranslationSegment[]): void {
  const prefix = line.match(STRUCTURAL_PREFIX)?.[1] ?? '';
  if (prefix.length > 0) pushProtected(segments, prefix);
  segmentInlineSpan(line.slice(prefix.length), segments);
}

function segmentInlineSpan(value: string, segments: TranslationSegment[]): void {
  const leading = value.match(/^\s+/u)?.[0] ?? '';
  if (leading.length > 0) pushProtected(segments, leading);
  const remainder = value.slice(leading.length);
  const trailing = remainder.match(/\s+$/u)?.[0] ?? '';
  const body = trailing.length === 0 ? remainder : remainder.slice(0, -trailing.length);
  const restorations: MarkdownRestoration[] = [];
  const rendered = renderInlineMarkdown(body, restorations);

  if (rendered.hasTranslatableText) {
    segments.push({
      html: rendered.html,
      kind: 'translatable',
      rebuild: { kind: 'inline', restorations },
    });
  } else {
    pushProtected(segments, body);
  }
  pushProtected(segments, trailing);
}

function segmentTableRow(
  line: string,
  structuralPrefixLength: number,
  segments: TranslationSegment[],
): void {
  const prefix = line.slice(0, structuralPrefixLength);
  if (prefix.length > 0) pushProtected(segments, prefix);

  const row = line.slice(structuralPrefixLength);
  const separators = tableSeparatorIndexes(row);
  const cells: TableCellRestoration[] = [];
  const parts: TableRowPart[] = [];
  let cursor = 0;
  for (const separator of separators) {
    addTableCell(row.slice(cursor, separator), cells, parts);
    parts.push({ kind: 'literal', text: '|' });
    cursor = separator + 1;
  }
  addTableCell(row.slice(cursor), cells, parts);

  if (cells.length === 0) {
    pushProtected(segments, row);
    return;
  }
  segments.push({
    html: cells
      .map((cell) => `<output data-table-cell="${cell.id}">${cell.html}</output>`)
      .join(' — '),
    kind: 'translatable',
    rebuild: { cells, kind: 'table-row', parts },
  });
}

function addTableCell(value: string, cells: TableCellRestoration[], parts: TableRowPart[]): void {
  const leading = value.match(/^\s+/u)?.[0] ?? '';
  const remainder = value.slice(leading.length);
  const trailing = remainder.match(/\s+$/u)?.[0] ?? '';
  const body = trailing.length === 0 ? remainder : remainder.slice(0, -trailing.length);
  const restorations: MarkdownRestoration[] = [];
  const rendered = renderInlineMarkdown(body, restorations);

  if (!rendered.hasTranslatableText && restorations.length === 0) {
    parts.push({ kind: 'literal', text: value });
    return;
  }
  const id = cells.length;
  cells.push({ html: rendered.html, id, restorations });
  parts.push({ cellId: id, kind: 'cell', leading, trailing });
}

function renderInlineMarkdown(
  markdown: string,
  restorations: MarkdownRestoration[],
): RenderedInline {
  let hasTranslatableText = false;
  let html = '';
  let remaining = markdown;

  while (remaining.length > 0) {
    const link = matchInlineLink(remaining);
    if (link !== null) {
      if (link.isImage || link.label.length === 0) {
        html += renderOpaque(link.whole, restorations);
      } else {
        const rendered = renderWrappedMarkdown(
          link.label,
          [
            {
              closeMarkdown: link.closeMarkdown,
              openMarkdown: '[',
              tagName: 'a',
            },
          ],
          restorations,
        );
        html += rendered.html;
        hasTranslatableText ||= rendered.hasTranslatableText;
      }
      remaining = remaining.slice(link.whole.length);
      continue;
    }

    const rawElement = matchRawHtmlElement(remaining);
    if (rawElement !== null) {
      if (CODE_LIKE_HTML_TAGS.has(rawElement.tagName)) {
        html += renderOpaque(rawElement.whole, restorations);
      } else {
        const rendered = renderWrappedMarkdown(
          rawElement.content,
          [
            {
              closeMarkdown: rawElement.closeMarkdown,
              openMarkdown: rawElement.openMarkdown,
              tagName: rawElement.tagName,
            },
          ],
          restorations,
        );
        html += rendered.html;
        hasTranslatableText ||= rendered.hasTranslatableText;
      }
      remaining = remaining.slice(rawElement.whole.length);
      continue;
    }

    const previousCharacter = markdown[markdown.length - remaining.length - 1];
    const delimited = matchDelimitedMarkup(remaining, previousCharacter);
    if (delimited !== null) {
      const rendered = renderWrappedMarkdown(delimited.content, delimited.wrappers, restorations);
      html += rendered.html;
      hasTranslatableText ||= rendered.hasTranslatableText;
      remaining = remaining.slice(delimited.length);
      continue;
    }

    const opaque = matchOpaqueMarkdown(remaining);
    if (opaque !== null) {
      html += renderOpaque(opaque, restorations);
      remaining = remaining.slice(opaque.length);
      continue;
    }

    const nextSyntaxIndex = findNextSyntaxIndex(remaining);
    const length = nextSyntaxIndex <= 0 ? 1 : nextSyntaxIndex;
    const prose = remaining.slice(0, length);
    html += escapeHtml(prose);
    hasTranslatableText ||= /[\p{L}\p{N}]/u.test(prose);
    remaining = remaining.slice(length);
  }

  return { hasTranslatableText, html };
}

function renderWrappedMarkdown(
  content: string,
  wrappers: readonly WrapperSyntax[],
  restorations: MarkdownRestoration[],
): RenderedInline {
  const tags = wrappers.map((wrapper) => {
    const id = restorations.length;
    restorations.push({ ...wrapper, id, kind: 'wrapper' });
    return { id, tagName: wrapper.tagName };
  });
  const rendered = renderInlineMarkdown(content, restorations);
  return {
    hasTranslatableText: rendered.hasTranslatableText,
    html:
      tags.map((tag) => `<${tag.tagName} data-md="${tag.id}">`).join('') +
      rendered.html +
      [...tags]
        .reverse()
        .map((tag) => `</${tag.tagName}>`)
        .join(''),
  };
}

function matchDelimitedMarkup(
  value: string,
  previousCharacter: string | undefined,
): {
  content: string;
  length: number;
  wrappers: readonly WrapperSyntax[];
} | null {
  for (const delimiter of DELIMITED_MARKUP) {
    if (!value.startsWith(delimiter.openMarkdown)) continue;
    const contentStart = delimiter.openMarkdown.length;
    if (value[contentStart] === undefined || /\s/u.test(value[contentStart])) continue;
    if (
      delimiter.openMarkdown.startsWith('_') &&
      isWordCharacter(previousCharacter) &&
      isWordCharacter(value[contentStart])
    ) {
      continue;
    }

    let closeIndex = value.indexOf(delimiter.closeMarkdown, contentStart + 1);
    while (closeIndex >= 0) {
      const content = value.slice(contentStart, closeIndex);
      const closeEnd = closeIndex + delimiter.closeMarkdown.length;
      const closesInsideWord =
        delimiter.closeMarkdown.startsWith('_') &&
        isWordCharacter(content.at(-1)) &&
        isWordCharacter(value[closeEnd]);
      if (content.length > 0 && !/\s$/u.test(content) && !closesInsideWord) {
        return {
          content,
          length: closeEnd,
          wrappers: delimiter.wrappers,
        };
      }
      closeIndex = value.indexOf(delimiter.closeMarkdown, closeIndex + 1);
    }
  }
  return null;
}

function matchInlineLink(value: string): {
  closeMarkdown: string;
  isImage: boolean;
  label: string;
  whole: string;
} | null {
  const isImage = value.startsWith('![');
  if (!isImage && !value.startsWith('[')) return null;

  const labelStart = isImage ? 2 : 1;
  let bracketDepth = 1;
  let labelEnd = -1;
  for (let index = labelStart; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\n') return null;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') bracketDepth += 1;
    if (character === ']') {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        labelEnd = index;
        break;
      }
    }
  }
  if (labelEnd < 0 || value[labelEnd + 1] !== '(') return null;

  const linkEnd = closingParenthesis(value, labelEnd + 1);
  if (linkEnd < 0) return null;
  const whole = value.slice(0, linkEnd + 1);
  return {
    closeMarkdown: value.slice(labelEnd, linkEnd + 1),
    isImage,
    label: value.slice(labelStart, labelEnd),
    whole,
  };
}

function closingParenthesis(value: string, openingIndex: number): number {
  let angleDestination = false;
  let depth = 1;
  let quote: '"' | "'" | null = null;
  for (let index = openingIndex + 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\n') return -1;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (angleDestination) {
      if (character === '>') angleDestination = false;
      continue;
    }
    if (character === '<' && depth === 1) {
      angleDestination = true;
      continue;
    }
    if ((character === '"' || character === "'") && /\s/u.test(value[index - 1] ?? '')) {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

interface RawHtmlTag {
  closing: boolean;
  end: number;
  selfClosing: boolean;
  tagName: string;
  whole: string;
}

function matchRawHtmlElement(value: string): {
  closeMarkdown: string;
  content: string;
  openMarkdown: string;
  tagName: string;
  whole: string;
} | null {
  const opening = parseRawHtmlTag(value, 0);
  if (
    opening === null ||
    opening.closing ||
    opening.selfClosing ||
    VOID_HTML_TAGS.has(opening.tagName)
  ) {
    return null;
  }

  let cursor = opening.end;
  let depth = 1;
  while (cursor < value.length) {
    const tagStart = value.indexOf('<', cursor);
    if (tagStart < 0) return null;
    const tag = parseRawHtmlTag(value, tagStart);
    if (tag === null) {
      cursor = tagStart + 1;
      continue;
    }
    cursor = tag.end;
    if (tag.tagName !== opening.tagName || tag.selfClosing) continue;
    depth += tag.closing ? -1 : 1;
    if (depth === 0) {
      return {
        closeMarkdown: tag.whole,
        content: value.slice(opening.end, tagStart),
        openMarkdown: opening.whole,
        tagName: opening.tagName,
        whole: value.slice(0, tag.end),
      };
    }
  }
  return null;
}

function parseRawHtmlTag(value: string, start: number): RawHtmlTag | null {
  if (value[start] !== '<' || value.startsWith('<!--', start)) return null;

  let quote: '"' | "'" | null = null;
  let end = -1;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\n') return null;
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      end = index + 1;
      break;
    }
  }
  if (end < 0) return null;

  const whole = value.slice(start, end);
  const body = whole.slice(1, -1).trim();
  const closing = body.startsWith('/');
  const name = (closing ? body.slice(1) : body).match(/^([A-Za-z][\w:-]*)/u)?.[1];
  if (name === undefined) return null;
  return {
    closing,
    end,
    selfClosing: !closing && /\/\s*$/u.test(body),
    tagName: name.toLocaleLowerCase('en-US'),
    whole,
  };
}

function matchOpaqueMarkdown(value: string): string | null {
  const patterns = [
    /^<!--[\s\S]*?-->/u,
    /^\[![\p{L}\p{N}_-]+\][+-]?/u,
    /^!?\[\[[^\]\n]+\]\]/u,
    /^(`+)[\s\S]*?\1/u,
    /^\$\$[^$\n]+?\$\$/u,
    /^\$[^$\n]+\$/u,
    /^https?:\/\/[^\s<>()]+/u,
    /^#[\p{L}\p{N}_/-]+/u,
    /^(?:\\[\\`*_[\]{}()#+\-.!>])/u,
    /^(?:\*\*|__|~~|==|`+|[*_[\]$<>=~|\\#])/u,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[0];
    if (match !== undefined) return match;
  }
  return parseRawHtmlTag(value, 0)?.whole ?? null;
}

function renderOpaque(markdown: string, restorations: MarkdownRestoration[]): string {
  const id = restorations.length;
  restorations.push({ id, kind: 'opaque', markdown, tagName: 'span' });
  return `<span data-md="${id}">${opaqueTranslationSurrogate(markdown)}</span>`;
}

function opaqueTranslationSurrogate(markdown: string): string {
  const rawTag = parseRawHtmlTag(markdown, 0);
  if (rawTag !== null && CODE_LIKE_HTML_TAGS.has(rawTag.tagName)) return 'code';
  if (/^`/u.test(markdown)) return 'code';
  if (/^!?\[\[/u.test(markdown) || /^\[!/u.test(markdown)) return 'note';
  if (/^\$/u.test(markdown)) return 'formula';
  if (/^https?:\/\//u.test(markdown)) return 'link';
  if (/^#/u.test(markdown)) return 'tag';
  if (/^!\[/u.test(markdown)) return 'image';
  if (/^</u.test(markdown)) return 'element';
  return 'symbol';
}

function restoreMarkdown(html: string, restorations: readonly MarkdownRestoration[]): string {
  const seen = new Map<number, number>();
  const wrapperStack: WrapperRestoration[] = [];
  let restored = '';
  let cursor = 0;
  GENERATED_TAG.lastIndex = 0;

  for (let match = GENERATED_TAG.exec(html); match !== null; match = GENERATED_TAG.exec(html)) {
    restored += decodeHtml(html.slice(cursor, match.index));
    const isClosing = (match[1] ?? '').length > 0;
    const tagName = (match[2] ?? '').toLocaleLowerCase('en-US');
    const attributes = match[3] ?? '';

    if (isClosing) {
      const open = wrapperStack.pop();
      if (open === undefined || open.tagName !== tagName) {
        throw new Error(
          `The translation runtime returned an unexpected closing HTML tag </${tagName}>.`,
        );
      }
      restored += open.closeMarkdown;
      cursor = GENERATED_TAG.lastIndex;
      continue;
    }

    const idText = attributes.match(RESTORATION_ATTRIBUTE)?.[1];
    if (idText === undefined) {
      throw new Error(`The translation runtime returned an unrecognized HTML tag <${tagName}>.`);
    }
    const id = Number.parseInt(idText, 10);
    const restoration = restorations[id];
    if (restoration === undefined || restoration.id !== id || restoration.tagName !== tagName) {
      throw new Error(`The translation runtime returned an unknown Markdown tag ${id}.`);
    }

    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (restoration.kind === 'opaque') {
      if (count > 1) {
        throw new Error(`The translation runtime duplicated protected Markdown tag ${id}.`);
      }
      const close = findOpaqueClosingTag(html, GENERATED_TAG.lastIndex);
      restored += restoration.markdown;
      GENERATED_TAG.lastIndex = close.end;
      cursor = close.end;
    } else {
      restored += restoration.openMarkdown;
      wrapperStack.push(restoration);
      cursor = GENERATED_TAG.lastIndex;
    }
  }

  restored += decodeHtml(html.slice(cursor));
  const unclosed = wrapperStack.at(-1);
  if (unclosed !== undefined) {
    throw new Error(`The translation runtime returned unclosed Markdown tag ${unclosed.id}.`);
  }
  for (const restoration of restorations) {
    if (!seen.has(restoration.id)) {
      throw new Error(
        `The translation runtime returned output missing Markdown tag ${restoration.id}.`,
      );
    }
  }
  return restored;
}

function restoreTableRow(html: string, rebuild: TableRowRebuild): string {
  const translatedCells = new Map<number, string>();
  const completedCells = new Set<number>();
  let previousId: number | null = null;
  let previousEnd = 0;
  TABLE_CELL_TAG.lastIndex = 0;

  for (let match = TABLE_CELL_TAG.exec(html); match !== null; match = TABLE_CELL_TAG.exec(html)) {
    const idText = (match[1] ?? '').match(TABLE_CELL_ATTRIBUTE)?.[1];
    if (idText === undefined) {
      throw new Error('The translation runtime returned a table cell without its identifier.');
    }
    const id = Number.parseInt(idText, 10);
    const cell = rebuild.cells[id];
    if (cell === undefined || cell.id !== id) {
      throw new Error(`The translation runtime returned an unknown Markdown table cell ${id}.`);
    }
    if (completedCells.has(id)) {
      throw new Error(`The translation runtime returned interleaved Markdown table cell ${id}.`);
    }

    const translated = translatedCells.get(id) ?? '';
    const between = previousId === id ? html.slice(previousEnd, match.index) : '';
    translatedCells.set(id, translated + between + (match[2] ?? ''));
    if (previousId !== null && previousId !== id) completedCells.add(previousId);
    previousId = id;
    previousEnd = TABLE_CELL_TAG.lastIndex;
  }

  const restoredCells = new Map<number, string>();
  for (const cell of rebuild.cells) {
    const translated = translatedCells.get(cell.id);
    if (translated === undefined) {
      throw new Error(
        `The translation runtime returned output missing Markdown table cell ${cell.id}.`,
      );
    }
    restoredCells.set(cell.id, restoreMarkdown(translated, cell.restorations));
  }
  return rebuild.parts
    .map((part) => {
      if (part.kind === 'literal') return part.text;
      const translated = restoredCells.get(part.cellId);
      if (translated === undefined) {
        throw new Error(`Missing rebuilt Markdown table cell ${part.cellId}.`);
      }
      return part.leading + translated + part.trailing;
    })
    .join('');
}

function findOpaqueClosingTag(html: string, start: number): { end: number } {
  const closingTag = /<\/span\s*>/giu;
  closingTag.lastIndex = start;
  const match = closingTag.exec(html);
  if (match === null) {
    throw new Error('The translation runtime returned an unclosed protected Markdown tag.');
  }
  return { end: closingTag.lastIndex };
}

function findNextSyntaxIndex(value: string): number {
  const candidates = [
    '[[',
    '![',
    '[',
    ']',
    '`',
    '$',
    'http://',
    'https://',
    '<',
    '>',
    '#',
    '*',
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
  for (
    let underscoreIndex = value.indexOf('_', 1);
    underscoreIndex >= 0;
    underscoreIndex = value.indexOf('_', underscoreIndex + 1)
  ) {
    if (
      !isWordCharacter(value[underscoreIndex - 1]) ||
      !isWordCharacter(value[underscoreIndex + 1])
    ) {
      index = Math.min(index, underscoreIndex);
      break;
    }
  }
  return index;
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function decodeHtml(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function quotedLineAt(lines: readonly string[], index: number): string {
  const completeLine = lines[index];
  if (completeLine === undefined) return '';
  const line = completeLine.endsWith('\n') ? completeLine.slice(0, -1) : completeLine;
  return line.slice((line.match(BLOCKQUOTE_PREFIX)?.[0] ?? '').length);
}

function isTableDelimiterRow(line: string): boolean {
  const separators = tableSeparatorIndexes(line);
  if (separators.length === 0) return false;

  const cells: string[] = [];
  let cursor = 0;
  for (const separator of separators) {
    cells.push(line.slice(cursor, separator));
    cursor = separator + 1;
  }
  cells.push(line.slice(cursor));
  if (cells[0]?.trim().length === 0) cells.shift();
  if (cells.at(-1)?.trim().length === 0) cells.pop();
  return cells.length >= 1 && cells.every((cell) => TABLE_DELIMITER_CELL.test(cell));
}

function tableSeparatorIndexes(value: string): number[] {
  const separators: number[] = [];
  let codeDelimiterLength = 0;
  let wikiLinkDepth = 0;

  for (let index = 0; index < value.length; ) {
    if (value[index] === '\\') {
      index += 2;
      continue;
    }

    if (value[index] === '`') {
      let runEnd = index + 1;
      while (value[runEnd] === '`') runEnd += 1;
      const runLength = runEnd - index;
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (runLength === codeDelimiterLength) {
        codeDelimiterLength = 0;
      }
      index = runEnd;
      continue;
    }
    if (codeDelimiterLength > 0) {
      index += 1;
      continue;
    }

    if (value.startsWith('[[', index)) {
      wikiLinkDepth += 1;
      index += 2;
      continue;
    }
    if (wikiLinkDepth > 0 && value.startsWith(']]', index)) {
      wikiLinkDepth -= 1;
      index += 2;
      continue;
    }
    if (wikiLinkDepth === 0 && value[index] === '|') separators.push(index);
    index += 1;
  }
  return separators;
}

function indentWidth(line: string): number {
  const indent = line.match(/^[ \t]*/u)?.[0] ?? '';
  return [...indent].reduce((width, character) => width + (character === '\t' ? 4 : 1), 0);
}

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

function pushProtected(segments: TranslationSegment[], text: string): void {
  if (text.length === 0) return;
  const previous = segments.at(-1);
  if (previous?.kind === 'protected') {
    previous.text += text;
  } else {
    segments.push({ kind: 'protected', text });
  }
}
