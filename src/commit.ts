/**
 * `waiver commit` (spec §17.4): apply a waiver and land it as a commit whose
 * message embeds the waiver, so the embedded block is well-formed by construction
 * and the author never hits a malformed-embedding `invalid` at verify time.
 */

import { applyWaiver } from './apply.js';
import { embedWaiver } from './commit-waiver.js';
import { DirtyTreeError, OpApplicationError } from './errors.js';
import { runGit } from './git.js';
import { loadWaiver } from './load.js';

export interface CommitOptions {
  /** Commit subject line; defaults to a generic refactor subject. */
  subject?: string;
  /** Repo path. Defaults to `process.cwd()`. */
  cwd?: string;
}

export async function commitWaiver(
  path: string,
  options: CommitOptions = {},
): Promise<{ sha: string }> {
  const cwd = options.cwd ?? process.cwd();

  // Refuse on a dirty tree so apply's output is the only staged change (§17.4).
  const status = await runGit(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (status.trim() !== '') throw new DirtyTreeError(cwd);

  // Load once — `loadWaiver` validates the schema, and the source may be stdin
  // (a `-` path), which is consumable, so we reuse the parsed waiver below.
  const waiver = await loadWaiver(path);

  const { files } = await applyWaiver(waiver, { cwd });
  if (files.length === 0) throw new OpApplicationError('commit', 'waiver produced no changes');

  await runGit(cwd, ['add', '--', ...files]);
  const subject = options.subject ?? 'refactor: apply waiver';
  await runGit(cwd, ['commit', '-m', embedWaiver(subject, waiver)]);
  return { sha: await runGit(cwd, ['rev-parse', 'HEAD']) };
}
