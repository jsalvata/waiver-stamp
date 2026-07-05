/**
 * Commit-embedded waivers (spec §17.1). A refactor commit carries its waiver as
 * a fenced ` ```waiver ` block in the message body. Parsing is pinned and fail-closed:
 * EVERY ` ```waiver ` fence is a claim — one that fails to parse, carries the wrong
 * (or no) `schema`, or fails validation is a present-but-broken claim and classifies
 * as `invalid`, never silently dropped to `none`.
 */

import { WaiverValidationError } from '../errors.ts';
import { loadWaiverFromObject } from './load.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { Waiver } from './types.ts';

export type WaiverBlock =
  | { kind: 'none' }
  | { kind: 'one'; waiver: Waiver }
  | { kind: 'invalid'; reason: string };

/** Max embedded-waiver size; real waivers are a few ops (spec §17.1 DoS guard). */
const MAX_BYTES = 64 * 1024;

/** Fenced ` ```waiver ` … ``` blocks (info string exactly `waiver`), content captured non-greedily. */
const WAIVER_FENCE = /```waiver[ \t\r]*\n([\s\S]*?)```/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Classify a commit message's embedded waiver (spec §17.1, fail-closed):
 * - no ` ```waiver ` fence → `none` (the commit is unwaivered);
 * - two or more fences → `invalid` (a commit is one atomic step);
 * - exactly one → a claim: oversized, unparseable, wrong-schema, or
 *   schema-invalid content is `invalid`, otherwise `one`.
 */
export function extractWaiverBlock(message: string): WaiverBlock {
  const fences = [...message.matchAll(WAIVER_FENCE)].map((m) => (m[1] ?? '').trim());

  if (fences.length === 0) return { kind: 'none' };
  if (fences.length > 1) {
    return { kind: 'invalid', reason: 'multiple waiver blocks in one commit' };
  }

  const raw = fences[0] ?? '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    return { kind: 'invalid', reason: 'embedded waiver exceeds 64 KiB' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'waiver block is not valid JSON' };
  }
  if (!isRecord(parsed) || parsed.schema !== SCHEMA_VERSION) {
    return { kind: 'invalid', reason: 'waiver block schema is not waiver-stamp/v0' };
  }
  try {
    return { kind: 'one', waiver: loadWaiverFromObject(parsed) };
  } catch (err) {
    const reason =
      err instanceof WaiverValidationError ? 'waiver failed schema validation' : 'invalid waiver';
    return { kind: 'invalid', reason };
  }
}
