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
import type { Platform, RipstopConfig } from './types.js';
import { compareParsed, parseVersion } from './version.js';


export interface SnoozeState {
  /** How many times the user has snoozed the current soft-update prompt. */
  count: number;
  /** Hours since the last snooze, or null if never snoozed / unknown. */
  hoursSinceLast: number | null;
}

export interface EvaluateContext {
  platform: Platform;
  appVersion: string;
  locale?: string;
  snooze?: SnoozeState;
}

export type Decision =
  | { type: 'kill'; message: string }
  | {
      type: 'maintenance';
      title: string;
      message: string;
      endsAt: string | null;
      showEta: boolean;
      buttonLabel: string;
      buttonUrl: string | null;
    }
  | { type: 'force'; title: string; body: string; storeUrl: string }
  | { type: 'soft'; title: string; body: string; storeUrl: string; canSnooze: boolean }
  | { type: 'none' };

const FALLBACK_LOCALE = 'en';

function resolveMessage(config: RipstopConfig, locale: string, key: string): string {
  return config.messages[locale]?.[key] ?? config.messages[FALLBACK_LOCALE]?.[key] ?? '';
}

export function evaluate(config: RipstopConfig, ctx: EvaluateContext): Decision {
  const locale = ctx.locale ?? FALLBACK_LOCALE;
  const version = parseVersion(ctx.appVersion);

  // 1. Kill
  const kill = config.kill;
  if (kill.active) {
    const platformMatch = kill.platforms.length === 0 || kill.platforms.includes(ctx.platform);
    let rangeMatch = kill.version_ranges.length === 0;
    if (!rangeMatch && version !== null) {
      rangeMatch = kill.version_ranges.some((r) => {
        const from = r.from === undefined ? null : parseVersion(r.from);
        const to = r.to === undefined ? null : parseVersion(r.to);
        if (from !== null && compareParsed(version, from) < 0) return false;
        if (to !== null && compareParsed(version, to) > 0) return false;
        return true;
      });
    }
    if (platformMatch && rangeMatch) {
      return { type: 'kill', message: resolveMessage(config, locale, kill.message_key) };
    }
  }

  // 2. Maintenance — `active` is server-evaluated at fetch time; starts_at/ends_at are display-only.
  const maintenance = config.maintenance;
  if (maintenance.active) {
    return {
      type: 'maintenance',
      title: resolveMessage(config, locale, 'maint_title'),
      message: resolveMessage(config, locale, maintenance.message_key),
      endsAt: maintenance.ends_at,
      showEta: maintenance.show_eta,
      buttonLabel: resolveMessage(config, locale, 'maint_button'),
      buttonUrl: maintenance.button_url ?? null,
    };
  }

  // 3–4. Force / soft — need a platform entry and a parseable version; otherwise fail open.
  const entry = config.update[ctx.platform];
  if (entry === undefined || version === null) return { type: 'none' };

  const min = parseVersion(entry.min);
  const target = parseVersion(entry.target);
  if (min === null || target === null) return { type: 'none' };

  if (compareParsed(version, min) < 0) {
    return {
      type: 'force',
      title: resolveMessage(config, locale, 'force_title'),
      body: resolveMessage(config, locale, 'force_body'),
      storeUrl: entry.store_url,
    };
  }

  if (compareParsed(version, target) < 0) {
    const snooze = ctx.snooze ?? { count: 0, hoursSinceLast: null };
    const suppressed =
      snooze.count > 0 &&
      snooze.hoursSinceLast !== null &&
      snooze.hoursSinceLast < entry.soft.cooldown_hours;
    if (suppressed) return { type: 'none' };
    return {
      type: 'soft',
      title: resolveMessage(config, locale, 'soft_title'),
      body: resolveMessage(config, locale, 'soft_body'),
      storeUrl: entry.store_url,
      canSnooze: snooze.count < entry.soft.max_snoozes,
    };
  }

  return { type: 'none' };
}

/**
 * Fail-open state machine (README §9): which config may drive a decision after
 * a fetch attempt. Any failure falls back to the last cached *signed* config;
 * with no cache, behave as `none`. Kill stickiness follows: a cached kill stays
 * in force until a fresh, signed config clears it.
 */
export type FetchOutcome = 'ok' | 'http_error' | 'timeout' | 'invalid_signature';
export type ConfigSource = 'fresh' | 'cached' | 'none';

export function resolveConfigSource(outcome: FetchOutcome, hasCache: boolean): ConfigSource {
  if (outcome === 'ok') return 'fresh';
  return hasCache ? 'cached' : 'none';
}
