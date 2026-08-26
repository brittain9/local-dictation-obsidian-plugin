const CALVER_PATTERN = /^(\d{4})\.(1[0-2]|[1-9])\.(0|[1-9]\d*)$/;

export function parseCalver(value, source = 'version') {
  const match = CALVER_PATTERN.exec(value);
  if (match === null) {
    throw new Error(
      `${source} "${value}" must match YYYY.M.MICRO with an unpadded month and non-negative MICRO.`,
    );
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    micro: BigInt(match[3]),
  };
}

export function compareCalverVersions(left, right) {
  const leftVersion = parseCalver(left, 'left version');
  const rightVersion = parseCalver(right, 'right version');

  const calendarDifference =
    leftVersion.year - rightVersion.year || leftVersion.month - rightVersion.month;
  if (calendarDifference !== 0) return calendarDifference;
  if (leftVersion.micro === rightVersion.micro) return 0;
  return leftVersion.micro < rightVersion.micro ? -1 : 1;
}
