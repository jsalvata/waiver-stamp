/**
 * Commit-embedded waivers (spec §17.1). A refactor commit carries its waiver as
 * a fenced ```json block in the message body. Parsing is pinned and fail-closed:
 * scan *every* json block, select those whose root `schema` equals exactly
 * "waiver-stamp/v0", and require exactly one.
 */

import { WaiverValidationError } from './errors.js';
import { loadWaiverFromObject } from './load.js';
import { SCHEMA_VERSION } from './schema.js';
import type { Waiver } from './types.js';

export type WaiverBlock =
  | { kind: 'none' }
  | { kind: 'one'; waiver: Waiver }
  | { kind: 'invalid'; reason: string };

/** Max embedded-waiver size; real waivers are a few ops (spec §17.1 DoS guard). */
const MAX_BYTES = 64 * 1024;

/** Fenced ```json … ``` blocks, content captured non-greedily. */
const JSON_FENCE = /```json[^\n]*\n([\s\S]*?)```/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Classify a commit message's embedded waiver (spec §17.1):
 * - no v0 waiver block → `none` (the commit is unwaivered);
 * - exactly one → validate it (`one` | `invalid`);
 * - two or more → `invalid` (a commit is one atomic step).
 */
export function extractWaiverBlock(message: string): WaiverBlock {
  const waiverBlocks: { raw: string; parsed: unknown }[] = [];
  for (const match of message.matchAll(JSON_FENCE)) {
    const raw = (match[1] ?? '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // not JSON → not a waiver block
    }
    if (isRecord(parsed) && parsed.schema === SCHEMA_VERSION) waiverBlocks.push({ raw, parsed });
  }

  if (waiverBlocks.length === 0) return { kind: 'none' };
  if (waiverBlocks.length > 1) {
    return { kind: 'invalid', reason: 'multiple waiver blocks in one commit' };
  }

  const only = waiverBlocks[0];
  if (!only) return { kind: 'none' };
  if (Buffer.byteLength(only.raw, 'utf8') > MAX_BYTES) {
    return { kind: 'invalid', reason: 'embedded waiver exceeds 64 KiB' };
  }
  try {
    return { kind: 'one', waiver: loadWaiverFromObject(only.parsed) };
  } catch (err) {
    const reason =
      err instanceof WaiverValidationError ? 'waiver failed schema validation' : 'invalid waiver';
    return { kind: 'invalid', reason };
  }
}

/** Produce a commit message that embeds `waiver` as a fenced ```json block (§17.1, §17.4). */
export function embedWaiver(subject: string, waiver: Waiver): string {
  const json = JSON.stringify(waiver, null, 2);
  return `${subject}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
