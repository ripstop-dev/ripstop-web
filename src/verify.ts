/**
 * Ed25519 verification of the exact bytes the server signed.
 *
 * `@noble/ed25519` rather than WebCrypto: `crypto.subtle` only gained Ed25519
 * recently and unevenly across browsers, and an SDK whose security property
 * silently degrades on older Safari is worse than one that carries 4 KB.
 *
 * The signature covers the raw response body, so verification happens before
 * anything is parsed — `JSON.parse` then `JSON.stringify` would produce
 * different bytes for the same document and reject payloads that were genuine.
 */
import { verifyAsync } from '@noble/ed25519';

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class SignatureVerifier {
  constructor(private readonly keys: Record<string, string>) {}

  /**
   * True only for a genuine signature by the named pinned key. Every failure —
   * unknown key, malformed base64, wrong length, bad signature — is a plain
   * false, and callers then fall back to cache.
   */
  async verify(body: string, signature: string, keyId: string): Promise<boolean> {
    const encoded = this.keys[keyId];
    if (encoded === undefined) return false;

    try {
      const publicKey = base64ToBytes(encoded);
      if (publicKey.length !== 32) return false;

      const sig = base64ToBytes(signature);
      if (sig.length !== 64) return false;

      return await verifyAsync(sig, new TextEncoder().encode(body), publicKey);
    } catch {
      // Malformed input is an invalid signature, not an exception thrown into
      // the host application.
      return false;
    }
  }
}
