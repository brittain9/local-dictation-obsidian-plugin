/**
 * Compares two dot-separated numeric version strings ("14.2.1"). Missing
 * segments count as 0, so "14" equals "14.0". Returns null when either side
 * has a non-numeric segment (or `a` is absent), so callers can treat unknown
 * versions conservatively instead of guessing a direction.
 */
export function compareVersions(a: string | null | undefined, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left === null || right === null) {
    return null;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart < rightPart) {
      return -1;
    }
    if (leftPart > rightPart) {
      return 1;
    }
  }

  return 0;
}

function parseVersion(version: string | null | undefined): number[] | null {
  if (version === null || version === undefined) {
    return null;
  }

  const parts = version
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isInteger) ? parts : null;
}
