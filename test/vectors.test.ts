/**
 * The conformance suite.
 *
 * `test/vectors.json` is vendored verbatim from `@ripstop/protocol` and is the
 * same file the reference implementation and the Flutter SDK run. It is what
 * makes "the SDKs agree" a fact rather than an intention.
 *
 * Adding a vector is a feature. Changing one is an ADR.
 */
import { describe, expect, it } from 'vitest';
import vectors from './vectors.json' with { type: 'json' };
import { evaluate, resolveConfigSource } from '../src/evaluate.js';
import type { FetchOutcome } from '../src/evaluate.js';
import { parseConfig } from '../src/types.js';
import type { Platform } from '../src/types.js';
import { compareVersions } from '../src/version.js';

const compare = vectors.compare as { a: string; b: string; expect: number }[];
const evaluations = vectors.evaluate as {
  name: string;
  patch?: Record<string, unknown>;
  context: { platform: string; appVersion: string; locale?: string; snooze?: { count: number; hoursSinceLast: number | null } };
  expect: Record<string, unknown>;
}[];
const sources = vectors.config_source as { fetch: string; hasCache: boolean; expect: string }[];

describe('compare', () => {
  it.each(compare)('$a vs $b -> $expect', ({ a, b, expect: want }) => {
    expect(compareVersions(a, b)).toBe(want);
    // Ordering is antisymmetric; a one-way vector would hide a sign error.
    expect(compareVersions(b, a)).toBe(want === 0 ? 0 : -want);
  });
});

describe('evaluate', () => {
  it.each(evaluations)('$name', ({ patch, context, expect: want }) => {
    // The patch replaces whole top-level keys, never a deep merge.
    const config = parseConfig({ ...vectors.base_config, ...(patch ?? {}) });
    expect(config).not.toBeNull();

    const decision = evaluate(config!, {
      platform: context.platform as Platform,
      appVersion: context.appVersion,
      ...(context.locale === undefined ? {} : { locale: context.locale }),
      ...(context.snooze === undefined ? {} : { snooze: context.snooze }),
    });

    // `expect` is a subset match: a vector asserts what it cares about.
    for (const [key, value] of Object.entries(want)) {
      expect(decision[key as keyof typeof decision]).toEqual(value);
    }
  });
});

describe('config_source', () => {
  it.each(sources)('$fetch + cache=$hasCache -> $expect', ({ fetch, hasCache, expect: want }) => {
    expect(resolveConfigSource(fetch as FetchOutcome, hasCache)).toBe(want);
  });
});
