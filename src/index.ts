/**
 * Ripstop for the web: remote config, update walls and maintenance mode,
 * signed at the edge and verified in the browser.
 *
 * ```ts
 * const ripstop = await Ripstop.init({
 *   apiKey: 'rs_pub_your_key',
 *   appVersion: '4.1.0',
 * });
 *
 * const decision = await ripstop.check();
 * if (decision.type === 'force') location.reload();
 * ```
 */
export { Ripstop, productionKeys } from './client.js';
export type { RipstopOptions } from './client.js';
export { evaluate, resolveConfigSource } from './evaluate.js';
export type {
  ConfigSource,
  Decision,
  EvaluateContext,
  FetchOutcome,
  SnoozeState,
} from './evaluate.js';
export { parseConfig } from './types.js';
export type {
  JsonValue,
  Maintenance,
  Platform,
  RipstopConfig,
  SoftPolicy,
  UpdateEntry,
} from './types.js';
export { LocalStorageAdapter, MemoryStorage } from './storage.js';
export type { RipstopStorage } from './storage.js';
export { compareVersions, parseVersion } from './version.js';
