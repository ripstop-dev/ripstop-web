/**
 * The client: fetch, verify, cache, decide.
 *
 * Web differs from mobile in one way that shapes everything here — there is no
 * app store and no "old build in the field", because a reload gets the latest
 * code. So `force` on web is not about a binary being stale, it is about a tab
 * that has been open for three days while you shipped a breaking change. The
 * decision is the same; what you do with it is usually "reload", not "go to
 * the App Store".
 */
import { evaluate, resolveConfigSource } from './evaluate.js';
import type { ConfigSource, Decision, FetchOutcome, SnoozeState } from './evaluate.js';
import { parseConfig } from './types.js';
import type { JsonValue, Platform, RipstopConfig } from './types.js';
import { SignatureVerifier } from './verify.js';
import { LocalStorageAdapter, MemoryStorage, Store } from './storage.js';
import type { RipstopStorage } from './storage.js';

const DEFAULT_ENDPOINT = 'https://cfg.ripstop.dev/v1/config';

export interface RipstopOptions {
  apiKey: string;
  /** The build the page is running. Rules are evaluated against this. */
  appVersion: string;
  platform?: Platform;
  locale?: string;
  /** How long a payload stays fresh enough to skip the network. */
  minFetchInterval?: number;
  timeoutMs?: number;
  /** Override the pinned keys, for self-hosted deployments and tests. */
  signingKeys?: Record<string, string>;
  storage?: RipstopStorage;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/** Pinned production signing keys, by `key_id`. */
export const productionKeys: Record<string, string> = {};

const SIX_HOURS = 6 * 60 * 60 * 1000;

export class Ripstop {
  private config: RipstopConfig | null = null;
  private snoozeState: SnoozeState = { count: 0, hoursSinceLast: null };
  private readonly verifier: SignatureVerifier;
  private readonly store: Store;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly minFetchInterval: number;
  private readonly timeoutMs: number;

  readonly apiKey: string;
  readonly appVersion: string;
  readonly platform: Platform;
  readonly locale: string;

  /** Where the config currently driving decisions came from. */
  source: ConfigSource = 'none';

  private constructor(options: RipstopOptions) {
    this.apiKey = options.apiKey;
    this.appVersion = options.appVersion;
    this.platform = options.platform ?? 'web';
    this.locale = options.locale ?? 'en';
    this.minFetchInterval = options.minFetchInterval ?? SIX_HOURS;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.verifier = new SignatureVerifier(options.signingKeys ?? productionKeys);
    this.store = new Store(
      options.storage ?? (hasLocalStorage() ? new LocalStorageAdapter() : new MemoryStorage()),
      options.apiKey,
    );
  }

  /**
   * Starts the SDK and performs the first check. Never throws: a missing
   * network, a wrong key or a mangled response all produce a working instance
   * whose decision is `none`.
   */
  static async init(options: RipstopOptions): Promise<Ripstop> {
    const instance = new Ripstop(options);
    await instance.refresh();
    await instance.loadSnooze();
    return instance;
  }

  /** Everything published under `values`, from the payload driving decisions. */
  get values(): Record<string, JsonValue> {
    return this.config?.values ?? {};
  }

  /** A typed read with a required fallback, because there may be no payload. */
  value<T extends JsonValue>(key: string, fallback: T): T {
    const found = this.config?.values[key];
    return (found === undefined ? fallback : found) as T;
  }

  async check(options: { force?: boolean } = {}): Promise<Decision> {
    if (options.force || this.config === null) await this.refresh(options);
    return this.decide();
  }

  /** Fetch, verify, cache. Respects `minFetchInterval` unless forced. */
  async refresh(options: { force?: boolean } = {}): Promise<void> {
    const cached = await this.store.readConfig();

    if (!options.force && cached !== null) {
      const age = Date.now() - cached.fetchedAt;
      if (age < this.minFetchInterval) {
        await this.adopt(cached.body, cached.signature, cached.keyId, 'cached');
        return;
      }
    }

    const outcome = await this.fetchConfig(cached);
    if (outcome === 'ok') return;

    // Fail open, with the last thing we know to be genuine.
    this.source = resolveConfigSource(outcome, cached !== null);
    if (cached !== null) {
      await this.adopt(cached.body, cached.signature, cached.keyId, 'cached');
    } else {
      this.config = null;
    }
  }

  private async fetchConfig(
    cached: { etag: string | null; body: string; signature: string; keyId: string } | null,
  ): Promise<FetchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'x-ripstop-platform': this.platform,
        'x-ripstop-app-version': this.appVersion,
      };
      if (cached?.etag) headers['if-none-match'] = cached.etag;

      const response = await this.fetchImpl(
        `${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`,
        { headers, signal: controller.signal },
      );

      // 304: what we hold is current. Re-stamp so the interval measures "last
      // confirmed", not "last changed".
      if (response.status === 304 && cached !== null) {
        await this.store.writeConfig({ ...cached, fetchedAt: Date.now() });
        await this.adopt(cached.body, cached.signature, cached.keyId, 'fresh');
        return 'ok';
      }

      if (!response.ok) return 'http_error';

      const signature = response.headers.get('x-ripstop-sig');
      const keyId = response.headers.get('x-ripstop-key-id');
      if (signature === null || keyId === null) return 'invalid_signature';

      const body = await response.text();
      if (!(await this.verifier.verify(body, signature, keyId))) return 'invalid_signature';

      await this.store.writeConfig({
        body,
        signature,
        keyId,
        etag: response.headers.get('etag'),
        fetchedAt: Date.now(),
      });
      await this.adopt(body, signature, keyId, 'fresh');
      return 'ok';
    } catch (error) {
      return (error as Error)?.name === 'AbortError' ? 'timeout' : 'http_error';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Adopts a payload only if it still verifies. Cached payloads get the same
   * scrutiny as fresh ones — localStorage is editable from the console, so
   * trusting it would make every wall a suggestion.
   */
  private async adopt(
    body: string,
    signature: string,
    keyId: string,
    source: ConfigSource,
  ): Promise<void> {
    if (!(await this.verifier.verify(body, signature, keyId))) {
      this.config = null;
      this.source = 'none';
      return;
    }
    try {
      this.config = parseConfig(JSON.parse(body));
      this.source = this.config === null ? 'none' : source;
    } catch {
      this.config = null;
      this.source = 'none';
    }
  }

  private decide(): Decision {
    if (this.config === null) return { type: 'none' };
    return evaluate(this.config, {
      platform: this.platform,
      appVersion: this.appVersion,
      locale: this.locale,
      snooze: this.snoozeState,
    });
  }

  /** Reads the snooze ledger for the current target version. */
  async loadSnooze(): Promise<void> {
    const target = this.config?.update[this.platform]?.target;
    if (target === undefined) {
      this.snoozeState = { count: 0, hoursSinceLast: null };
      return;
    }

    const record = await this.store.readSnooze();
    // A new target is a new ask: the allowance resets rather than carrying a
    // grudge from the release before.
    if (record === null || record.version !== target) {
      this.snoozeState = { count: 0, hoursSinceLast: null };
      return;
    }

    this.snoozeState = {
      count: record.count,
      hoursSinceLast: record.lastAt === null ? null : (Date.now() - record.lastAt) / 3_600_000,
    };
  }

  /** Records a snooze of the current soft prompt and re-evaluates. */
  async snooze(): Promise<Decision> {
    const target = this.config?.update[this.platform]?.target;
    if (target === undefined) return this.decide();

    const existing = await this.store.readSnooze();
    const count = existing !== null && existing.version === target ? existing.count + 1 : 1;
    await this.store.writeSnooze({ version: target, count, lastAt: Date.now() });
    await this.loadSnooze();
    return this.decide();
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    // Access itself throws when cookies are blocked; memory is the answer.
    return false;
  }
}
