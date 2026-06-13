export function pickFirstExistingDir(
  candidates: string[],
  exists: (dir: string) => boolean,
): string;
