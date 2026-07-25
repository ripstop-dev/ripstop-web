# Changelog

## Unreleased

- `appVersion` stays required, while the Swift and Flutter SDKs now detect it.
  A browser has no bundle and no installed version to read: the build is the
  only thing that knows which build is running. Documented in the README.

## 0.1.0

First release.

- Force update, soft update and maintenance mode, decided by the protocol's
  evaluation order and verified against the golden vectors.
- Remote config values in the same signed payload, so there is no extra request.
- Ed25519 verification of the exact response bytes, with pinned keys and
  `key_id` rotation.
- Signed cache in localStorage, re-verified on read.
- Snooze accounting per target version, with cooldown.
- 6.5 KB gzipped, no framework, no dependencies beyond `@noble/ed25519`.
