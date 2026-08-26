export interface Calver {
  year: number;
  month: number;
  micro: bigint;
}

export function parseCalver(value: string, source?: string): Calver;
export function compareCalverVersions(left: string, right: string): number;
