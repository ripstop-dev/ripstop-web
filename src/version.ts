/**
 * Vendored from `@ripstop/protocol`.
 *
 * A public SDK may never depend on the private control-plane monorepo
 * (ADR-008), so the protocol's pure logic is copied here rather than imported.
 * `test/vectors.test.ts` runs the same golden file the reference
 * implementation does, which is what keeps the copy honest.
 *
 * Don't hand-edit this to change behaviour: change the protocol, re-vendor,
 * and let the vectors decide.
 */
export interface ParsedVersion {
  /** Numeric segments, 1–4 entries. Missing segments compare as 0. */
  nums: number[];
  /** Pre-release identifiers (after `-`), or null for a release version. */
  pre: string[] | null;
}

export function parseVersion(input: string): ParsedVersion | null {
  const plus = input.indexOf('+');
  const noBuild = plus === -1 ? input : input.slice(0, plus);
  const dash = noBuild.indexOf('-');
  const main = dash === -1 ? noBuild : noBuild.slice(0, dash);
  const preRaw = dash === -1 ? null : noBuild.slice(dash + 1);

  if (main.length === 0) return null;
  const parts = main.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(parseInt(part, 10));
  }

  let pre: string[] | null = null;
  if (preRaw !== null) {
    if (preRaw.length === 0) return null;
    pre = preRaw.split('.');
    for (const id of pre) {
      if (!/^[0-9A-Za-z-]+$/.test(id)) return null;
    }
  }

  return { nums, pre };
}

function comparePreIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const diff = parseInt(a, 10) - parseInt(b, 10);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  const len = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < len; i++) {
    const av = a.nums[i] ?? 0;
    const bv = b.nums[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }

  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1; // release > pre-release
  if (b.pre === null) return -1;

  const preLen = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < preLen; i++) {
    const aId = a.pre[i];
    const bId = b.pre[i];
    if (aId === undefined || bId === undefined) break;
    const diff = comparePreIdentifiers(aId, bId);
    if (diff !== 0) return diff;
  }
  return a.pre.length === b.pre.length ? 0 : a.pre.length < b.pre.length ? -1 : 1;
}

/** Returns -1 | 0 | 1. Throws if either input is not a valid version string. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new Error(`invalid version: ${a}`);
  if (pb === null) throw new Error(`invalid version: ${b}`);
  return compareParsed(pa, pb);
}
