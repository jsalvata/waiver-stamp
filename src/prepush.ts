/**
 * Pre-push drift guard (§6.3). The dependency-bump policy's lockfile check consults
 * the live registry, so it is *time-varying*: a bump authored days before it is pushed
 * can fail verification once a floating spec re-resolves to a newer version than the
 * committed lockfile records. All such failures are fail-closed (the commit falls to
 * human review), so the cost is CI flakiness, not safety — but re-verifying at push
 * time shrinks the author→CI window to minutes.
 *
 * Only a *waivered* commit that touches `package.json`/`pnpm-lock.yaml` can go stale:
 * reproductive/exclusion ops validate against the commit's own (unchanging) parent, so
 * they are deterministic. The guard therefore skips everything else and costs ~0 for
 * ordinary pushes — no network, no pnpm — unless a waivered bump is actually outgoing.
 */

import { extractWaiverBlock } from './commit-waiver.ts';
import {
  changedFiles,
  commitMessage,
  commitsInRange,
  commitsNotOnRemotes,
  parents,
} from './git.ts';
import type { PerCommitResult } from './report.ts';
import { classifyCommit } from './verify.ts';

/** Files the standing bump policy governs (root manifest + lockfile; §6.3). */
const BUMP_FILES = ['package.json', 'pnpm-lock.yaml'];

/** An all-zero object id — git's placeholder for "no such ref" (githooks(5)). */
const ZERO_OID = /^0+$/;

export interface PrepushOptions {
  /** Repo path. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Raw stdin from git's pre-push hook: one `<local-ref> <local-sha> <remote-ref>
   * <remote-sha>` line per ref (githooks(5)). Absent/empty → standalone mode, which
   * derives the outgoing range from the upstream tracking configuration.
   */
  stdin?: string;
  /** Verification test seam (§6.3), threaded to `classifyCommit`. Defaults to real pnpm. */
  resolveLockfile?: (dir: string) => Promise<void>;
}

/** One ref line from git's pre-push stdin. */
export interface PushRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
  /** The local side is the zero-oid → this ref is being *deleted*; nothing to verify. */
  deleted: boolean;
  /** The remote side is the zero-oid → a *new* ref; diff against remote-tracking refs. */
  newBranch: boolean;
}

/** A commit whose embedded waiver no longer stamps at push time. */
export interface DriftFinding {
  /** The verification result (`class !== 'stamped'`). */
  result: PerCommitResult;
  /** The commit's parent SHA — where its pre-bump lockfile lives (for the recipe). */
  parent: string;
}

export interface PrepushReport {
  /** Outgoing commits that were re-verified (waivered bumps). */
  candidates: string[];
  /** The subset whose verification failed — drifted or otherwise no longer valid. */
  failures: DriftFinding[];
}

/**
 * Parse git's pre-push stdin into structured ref lines (githooks(5)). Blank and
 * malformed lines are dropped; deletions and new branches are flagged, not discarded,
 * so the range logic can special-case them.
 */
export function parsePushRefs(stdin: string): PushRef[] {
  const refs: PushRef[] = [];
  for (const line of stdin.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts as [string, string, string, string];
    const deleted = ZERO_OID.test(localSha);
    refs.push({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
      deleted,
      newBranch: !deleted && ZERO_OID.test(remoteSha),
    });
  }
  return refs;
}

/** Re-verify every outgoing waivered dependency bump; report those that no longer stamp. */
export async function prepush(options: PrepushOptions = {}): Promise<PrepushReport> {
  const cwd = options.cwd ?? process.cwd();
  const outgoing = await outgoingCommits(cwd, options.stdin);

  const candidates: string[] = [];
  for (const sha of outgoing) {
    if (await isWaiveredBump(cwd, sha)) candidates.push(sha);
  }

  const failures: DriftFinding[] = [];
  for (const sha of candidates) {
    const result = await classifyCommit(cwd, sha, options.resolveLockfile);
    if (result.class !== 'stamped') {
      const [parent] = await parents(cwd, sha);
      failures.push({ result, parent: parent ?? `${sha}^` });
    }
  }
  return { candidates, failures };
}

/** The set of outgoing commits, oldest-first and de-duplicated across refs. */
async function outgoingCommits(cwd: string, stdin?: string): Promise<string[]> {
  const refs = stdin ? parsePushRefs(stdin) : [];
  const shas: string[] = refs.length > 0 ? await hookRange(cwd, refs) : await standaloneRange(cwd);
  return [...new Set(shas)];
}

/** Commits pushed by the hook's ref lines (skipping deletions; new branches → not-on-remotes). */
async function hookRange(cwd: string, refs: PushRef[]): Promise<string[]> {
  const shas: string[] = [];
  for (const ref of refs) {
    if (ref.deleted) continue;
    shas.push(
      ...(ref.newBranch
        ? await commitsNotOnRemotes(cwd, ref.localSha)
        : await commitsInRange(cwd, ref.remoteSha, ref.localSha)),
    );
  }
  return shas;
}

/** Standalone outgoing range: `@{push}`, then `@{upstream}`, then anything not on a remote. */
async function standaloneRange(cwd: string): Promise<string[]> {
  for (const base of ['@{push}', '@{upstream}']) {
    try {
      return await commitsInRange(cwd, base, 'HEAD');
    } catch {
      // Not configured for this branch — try the next fallback.
    }
  }
  return commitsNotOnRemotes(cwd, 'HEAD');
}

/** A candidate iff it is an ordinary (single-parent) waivered commit touching a bump file. */
async function isWaiveredBump(cwd: string, sha: string): Promise<boolean> {
  const ps = await parents(cwd, sha);
  if (ps.length !== 1 || !ps[0]) return false; // merges/roots are deterministic (§6.3).
  if (extractWaiverBlock(await commitMessage(cwd, sha)).kind === 'none') return false;
  const files = await changedFiles(cwd, ps[0], sha);
  return BUMP_FILES.some((f) => files.includes(f));
}

/**
 * Render drifted commits and the refresh recipe for a human (or agent) to act on.
 * The recipe restores the *parent's* lockfile first — a plain `pnpm install` on an
 * up-to-date worktree is a no-op, so the changed specs only re-resolve once the old
 * lock is back in place.
 */
export function formatDriftReport(failures: readonly DriftFinding[]): string {
  const lines: string[] = [
    `waiver prepush: ${failures.length} outgoing waivered dependency bump(s) no longer stamp.`,
    'The lockfile likely drifted against the live registry since it was authored.',
    '',
  ];
  for (const { result } of failures) {
    lines.push(`  ✗ ${result.sha.slice(0, 8)} ${result.subject}`);
    for (const reason of result.reasons) lines.push(`      ${reason}`);
  }
  lines.push('', 'Refresh each drifted commit by re-resolving its lockfile:', '');
  for (const { result } of failures) {
    lines.push(
      `  # ${result.sha.slice(0, 8)} ${result.subject}`,
      `  git show ${result.sha}^:pnpm-lock.yaml > pnpm-lock.yaml`,
      '  pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile',
      '  git commit --amend --no-edit   # if it is HEAD; otherwise rewrite that commit',
      '',
    );
  }
  lines.push('Then re-push. To bypass this guard once, push with --no-verify.');
  return lines.join('\n');
}
