const BOUNDARY_PATTERNS: readonly RegExp[] = [/\n\s*\n/gu, /[.!?]\s+/gu, /\s+/gu];

export function truncateLeadingText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) {
    return { text: '', truncated: text.length > 0 };
  }
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: trimToLastBoundary(text.slice(0, maxChars)), truncated: true };
}

export function truncateTrailingText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) {
    return { text: '', truncated: text.length > 0 };
  }
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: trimFromFirstBoundary(text.slice(text.length - maxChars)),
    truncated: true,
  };
}

function trimToLastBoundary(text: string): string {
  for (const pattern of BOUNDARY_PATTERNS) {
    let lastEnd = -1;
    for (const match of text.matchAll(pattern)) {
      lastEnd = (match.index ?? 0) + match[0].length;
    }
    if (lastEnd > 0) {
      return text.slice(0, lastEnd).trimEnd();
    }
  }
  return text.trimEnd();
}

function trimFromFirstBoundary(text: string): string {
  for (const pattern of BOUNDARY_PATTERNS) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    if (match !== null) {
      return text.slice((match.index ?? 0) + match[0].length).trimStart();
    }
  }
  return text.trimStart();
}
