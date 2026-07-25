/**
 * Where the last signed payload and the snooze ledger live.
 *
 * The payload is stored *with* its signature and re-verified on read, so a
 * cached config carries exactly as much authority as a fresh one, and no more.
 * On the web this matters more than on mobile: localStorage is two keystrokes
 * away in devtools, so a cache that were trusted would make every wall a
 * polite request.
 */

export interface CachedConfig {
  body: string;
  signature: string;
  keyId: string;
  etag: string | null;
  fetchedAt: number;
}

export interface SnoozeRecord {
  /** Which target this counts against; a new target resets the allowance. */
  version: string;
  count: number;
  lastAt: number | null;
}

/** Swap this for sessionStorage, IndexedDB, or nothing at all. */
export interface RipstopStorage {
  read(key: string): string | null | Promise<string | null>;
  write(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export class LocalStorageAdapter implements RipstopStorage {
  read(key: string): string | null {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  write(key: string, value: string): void {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Private mode, quota, blocked cookies. Losing the cache costs offline
      // support, not correctness, so this is not worth an exception.
    }
  }
  remove(key: string): void {
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      /* see write */
    }
  }
}

/** For SSR, tests, and anyone who would rather keep nothing on disk. */
export class MemoryStorage implements RipstopStorage {
  private readonly values = new Map<string, string>();
  read(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.values.set(key, value);
  }
  remove(key: string): void {
    this.values.delete(key);
  }
}

/** Typed access over whichever storage is in use. */
export class Store {
  constructor(
    private readonly storage: RipstopStorage,
    /** Namespaced so two Ripstop-powered apps never share a cache. */
    private readonly apiKey: string,
  ) {}

  private get configKey(): string {
    return `ripstop.config.${this.apiKey}`;
  }
  private get snoozeKey(): string {
    return `ripstop.snooze.${this.apiKey}`;
  }

  async readConfig(): Promise<CachedConfig | null> {
    const raw = await this.storage.read(this.configKey);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CachedConfig>;
      if (typeof parsed.body !== 'string') return null;
      if (typeof parsed.signature !== 'string') return null;
      if (typeof parsed.keyId !== 'string') return null;
      return {
        body: parsed.body,
        signature: parsed.signature,
        keyId: parsed.keyId,
        etag: typeof parsed.etag === 'string' ? parsed.etag : null,
        fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
      };
    } catch {
      return null;
    }
  }

  async writeConfig(config: CachedConfig): Promise<void> {
    await this.storage.write(this.configKey, JSON.stringify(config));
  }

  async readSnooze(): Promise<SnoozeRecord | null> {
    const raw = await this.storage.read(this.snoozeKey);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SnoozeRecord>;
      if (typeof parsed.version !== 'string') return null;
      return {
        version: parsed.version,
        count: typeof parsed.count === 'number' ? parsed.count : 0,
        lastAt: typeof parsed.lastAt === 'number' ? parsed.lastAt : null,
      };
    } catch {
      return null;
    }
  }

  async writeSnooze(record: SnoozeRecord): Promise<void> {
    await this.storage.write(this.snoozeKey, JSON.stringify(record));
  }
}
