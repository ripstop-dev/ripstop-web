/**
 * What the client promises when things go wrong, which is the only time
 * anybody finds out whether a config SDK was written carefully.
 *
 * These sign with a real key pair and stub `fetch`, so the verification path is
 * exercised for real. A verifier that is mocked in tests is a verifier nobody
 * has checked.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPublicKeyAsync, signAsync, utils } from '@noble/ed25519';
import { Ripstop } from '../src/client.js';
import { MemoryStorage } from '../src/storage.js';

const KEY = 'rs_pub_test';
const KEY_ID = 'k1';

let privateKey: Uint8Array;
let publicKeyB64: string;

const bytesToBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

beforeAll(async () => {
  privateKey = utils.randomSecretKey();
  publicKeyB64 = bytesToBase64(await getPublicKeyAsync(privateKey));
});

function config(options: { maintenance?: boolean; min?: string; target?: string } = {}) {
  return {
    v: 1,
    app: 'app_test',
    env: 'production',
    published_at: '2026-01-01T00:00:00Z',
    key_id: KEY_ID,
    maintenance: {
      active: options.maintenance ?? false,
      starts_at: null,
      ends_at: null,
      message_key: 'maint_default',
      show_eta: true,
    },
    update: {
      web: {
        min: options.min ?? '4.0.0',
        target: options.target ?? '4.2.0',
        store_url: 'https://app.example.com',
        soft: { max_snoozes: 2, cooldown_hours: 24 },
      },
    },
    values: { checkout_enabled: true },
    messages: {
      en: {
        force_title: 'Update required',
        force_body: 'Reload to continue.',
        soft_title: 'Update available',
        soft_body: 'A new version is ready.',
        maint_default: 'Back soon',
      },
    },
  };
}

/** A stub `fetch` that signs whatever it serves, and counts calls. */
function server(payload: object, options: { status?: number; corrupt?: boolean } = {}) {
  const state = { calls: 0, lastHeaders: {} as Record<string, string> };
  const impl = (async (_url: string, init?: RequestInit) => {
    state.calls += 1;
    state.lastHeaders = (init?.headers ?? {}) as Record<string, string>;

    if (options.status !== undefined && options.status >= 400) {
      return new Response('nope', { status: options.status });
    }

    const body = JSON.stringify(payload);
    const signature = options.corrupt
      ? new Uint8Array(64).fill(7)
      : await signAsync(new TextEncoder().encode(body), privateKey);

    return new Response(body, {
      status: 200,
      headers: {
        'x-ripstop-sig': bytesToBase64(signature),
        'x-ripstop-key-id': KEY_ID,
        etag: '"cfg_1"',
      },
    });
  }) as unknown as typeof fetch;

  return { impl, state };
}

const boot = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof Ripstop.init>[0]> = {}) =>
  Ripstop.init({
    apiKey: KEY,
    appVersion: '3.0.0',
    platform: 'web',
    signingKeys: { [KEY_ID]: publicKeyB64 },
    storage: new MemoryStorage(),
    fetchImpl,
    ...extra,
  });

describe('the client', () => {
  it('lets a genuine payload drive the decision', async () => {
    const { impl } = server(config());
    const gate = await boot(impl);

    expect((await gate.check()).type).toBe('force');
    expect(gate.source).toBe('fresh');
    expect(gate.value('checkout_enabled', false)).toBe(true);
  });

  it('refuses a forged signature and lets the app run', async () => {
    const { impl } = server(config({ maintenance: true }), { corrupt: true });
    const gate = await boot(impl);

    expect((await gate.check()).type).toBe('none');
    expect(gate.source).toBe('none');
  });

  it('refuses an unknown key id', async () => {
    const { impl } = server(config());
    const gate = await boot(impl, { signingKeys: { other: publicKeyB64 } });
    expect((await gate.check()).type).toBe('none');
  });

  it('falls back to cache when the network fails', async () => {
    const storage = new MemoryStorage();
    const good = server(config({ maintenance: true }));
    const first = await boot(good.impl, { storage });
    expect((await first.check()).type).toBe('maintenance');

    const broken = server(config(), { status: 500 });
    const second = await boot(broken.impl, { storage });

    expect((await second.check()).type).toBe('maintenance');
    expect(second.source).toBe('cached');
  });

  it('refuses a tampered cache', async () => {
    const storage = new MemoryStorage();
    const good = server(config({ maintenance: true }));
    await boot(good.impl, { storage });

    // Someone opens devtools and edits localStorage to lift the maintenance wall.
    const raw = JSON.parse(storage.read(`ripstop.config.${KEY}`)!) as { body: string };
    raw.body = JSON.stringify(config());
    storage.write(`ripstop.config.${KEY}`, JSON.stringify(raw));

    const offline = server(config(), { status: 500 });
    const gate = await boot(offline.impl, { storage });
    expect((await gate.check()).type).toBe('none');
  });

  it('does not refetch inside the interval', async () => {
    const storage = new MemoryStorage();
    const { impl, state } = server(config());

    await boot(impl, { storage });
    expect(state.calls).toBe(1);

    await boot(impl, { storage });
    expect(state.calls).toBe(1);
  });

  it('sends the stored etag on a conditional request', async () => {
    const storage = new MemoryStorage();
    const { impl, state } = server(config());
    const gate = await boot(impl, { storage });

    await gate.refresh({ force: true });
    expect(state.lastHeaders['if-none-match']).toBe('"cfg_1"');
  });

  it('treats a timeout as a failure, not a crash', async () => {
    const hang = (() =>
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5),
      )) as unknown as typeof fetch;

    const gate = await boot(hang, { timeoutMs: 1 });
    expect((await gate.check()).type).toBe('none');
    expect(gate.source).toBe('none');
  });

  it('runs the snooze allowance down', async () => {
    const storage = new MemoryStorage();
    const { impl } = server(config());
    const gate = await boot(impl, { storage, appVersion: '4.1.0' });

    const soft = await gate.check();
    expect(soft.type).toBe('soft');
    expect(soft.type === 'soft' && soft.canSnooze).toBe(true);

    // Snoozing hides it until the cooldown elapses.
    expect((await gate.snooze()).type).toBe('none');

    // Exhaust the allowance and age the stamp past the cooldown.
    storage.write(
      `ripstop.snooze.${KEY}`,
      JSON.stringify({ version: '4.2.0', count: 2, lastAt: Date.now() - 48 * 3_600_000 }),
    );
    await gate.loadSnooze();

    const again = await gate.check();
    expect(again.type).toBe('soft');
    expect(again.type === 'soft' && again.canSnooze).toBe(false);
  });
});
