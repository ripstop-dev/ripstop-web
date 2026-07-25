/**
 * The payload's shape, as types plus a hand-written parser.
 *
 * The control plane validates with Zod; this SDK does not, deliberately. Zod is
 * ~14 KB gzipped and would be the largest thing in a package whose whole point
 * is to be small enough that nobody thinks twice about adding it. The server
 * already guarantees the shape, the signature guarantees the bytes came from
 * the server, and anything unreadable falls open — so a schema library here
 * would buy a nicer error message on a path that is already safe.
 */

export type Platform = 'ios' | 'android' | 'web';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Maintenance {
  /** Server-evaluated at fetch time. The browser never checks the schedule. */
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  message_key: string;
  show_eta: boolean;
  button_url?: string | null;
}

export interface SoftPolicy {
  max_snoozes: number;
  cooldown_hours: number;
}

export interface UpdateEntry {
  min: string;
  target: string;
  store_url: string;
  soft: SoftPolicy;
  use_play_in_app_updates?: boolean;
}

export interface RipstopConfig {
  v: number;
  app: string;
  env: string;
  published_at: string;
  key_id: string;
  maintenance: Maintenance;
  update: Partial<Record<Platform, UpdateEntry>>;
  values: Record<string, JsonValue>;
  messages: Record<string, Record<string, string>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback;
const int = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;

/**
 * Parses a payload, or returns null if it is not one at all.
 *
 * Forgiving in exactly one direction: unknown fields are ignored, so a newer
 * control plane can add one without breaking apps already in the field. A
 * field we do recognise but cannot read makes the whole payload null, and a
 * null payload never drives a decision.
 */
export function parseConfig(input: unknown): RipstopConfig | null {
  if (!isRecord(input)) return null;

  const rawUpdate = isRecord(input.update) ? input.update : {};
  const update: Partial<Record<Platform, UpdateEntry>> = {};
  for (const platform of ['ios', 'android', 'web'] as const) {
    const entry = rawUpdate[platform];
    if (!isRecord(entry)) continue;
    const min = entry.min;
    const target = entry.target;
    // A rule without both versions is not a rule; the protocol refuses half.
    if (typeof min !== 'string' || typeof target !== 'string') continue;
    const soft = isRecord(entry.soft) ? entry.soft : {};
    update[platform] = {
      min,
      target,
      store_url: str(entry.store_url),
      soft: {
        max_snoozes: int(soft.max_snoozes, 3),
        cooldown_hours: int(soft.cooldown_hours, 24),
      },
    };
  }

  const rawMessages = isRecord(input.messages) ? input.messages : {};
  const messages: Record<string, Record<string, string>> = {};
  for (const [locale, strings] of Object.entries(rawMessages)) {
    if (!isRecord(strings)) continue;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(strings)) {
      if (typeof value === 'string') out[key] = value;
    }
    messages[locale] = out;
  }

  // Legacy payloads may still carry a `kill` key; like any other unknown
  // field, it is simply never read.
  const maintenance = isRecord(input.maintenance) ? input.maintenance : {};

  return {
    v: int(input.v, 1),
    app: str(input.app),
    env: str(input.env, 'production'),
    published_at: str(input.published_at),
    key_id: str(input.key_id),
    maintenance: {
      active: bool(maintenance.active),
      starts_at: typeof maintenance.starts_at === 'string' ? maintenance.starts_at : null,
      ends_at: typeof maintenance.ends_at === 'string' ? maintenance.ends_at : null,
      message_key: str(maintenance.message_key, 'maint_default'),
      show_eta: bool(maintenance.show_eta, true),
      button_url: typeof maintenance.button_url === 'string' ? maintenance.button_url : null,
    },
    update,
    values: isRecord(input.values) ? (input.values as Record<string, JsonValue>) : {},
    messages,
  };
}
