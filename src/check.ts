import { loadWaiver } from './load.js';
import type { Waiver } from './types.js';

export interface CheckResult {
  ok: boolean;
  waiver: Waiver;
}

/**
 * Fast lint (§10): schema + header validation only.
 *
 * In the v0 scaffold this is schema + header validation via {@link loadWaiver}.
 * The static guards of §8 (single-project, public-API, dynamic-reference,
 * emit-divergence) require a loaded ts-morph program and arrive with the engine.
 *
 * Throws on a malformed or non-conforming waiver (see {@link loadWaiver}).
 */
export async function check(path: string): Promise<CheckResult> {
  const waiver = await loadWaiver(path);
  return { ok: true, waiver };
}
