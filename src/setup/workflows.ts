import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parse } from 'yaml';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const CI_CALLER = '.github/workflows/waiver-stamp-ci.yml';
const REVIEW_CALLER = '.github/workflows/waiver-stamp-review.yml';

/** Parse every `*.yml`/`*.yaml` in `dir`, tolerating a missing directory or an unparseable file. */
async function readWorkflows(dir: string): Promise<Array<Record<string, unknown>>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const name of names) {
    if (!/\.ya?ml$/.test(name)) continue;
    try {
      const doc = parse(await readFile(join(dir, name), 'utf8'));
      if (doc && typeof doc === 'object') out.push(doc as Record<string, unknown>);
    } catch {
      // A malformed workflow is the adopter's to fix; it just doesn't contribute a name here.
    }
  }
  return out;
}

/**
 * The adopter's own CI workflow `name:`s (§4.8) — the values that must go into the reviewer's
 * `workflow_run.workflows:` trigger. Our own `waiver-stamp-*` callers are skipped so a re-run
 * doesn't rediscover them as producers.
 */
export async function discoverCiWorkflowNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const doc of await readWorkflows(dir)) {
    const name = doc.name;
    if (typeof name === 'string' && !name.startsWith('waiver-stamp') && !names.includes(name))
      names.push(name);
  }
  return names;
}

/**
 * The check name of a job that runs the lockfile-honesty gate (§4.8) — its `name:` if set, else
 * the job id. Fed into `.waiver-stamp.json` only via the §4.11 seeding rule, never a silent edit.
 * `null` when no job references lockfile-assay (the "assumes the lockfile is honest" caveat stays).
 */
export async function detectLockfileHonestyCheck(dir: string): Promise<string | null> {
  for (const doc of await readWorkflows(dir)) {
    const jobs = doc.jobs;
    if (!jobs || typeof jobs !== 'object') continue;
    for (const [id, job] of Object.entries(jobs as Record<string, unknown>)) {
      if (!JSON.stringify(job).includes('lockfile-assay')) continue;
      const name = (job as { name?: unknown }).name;
      return typeof name === 'string' ? name : id;
    }
  }
  return null;
}

/**
 * Pick the honesty-check name to record in `.waiver-stamp.json` (§4.11). The reviewer only
 * silences the "assumes the lockfile is honest" caveat when the named check is in the base
 * branch's *required* set — so a required context wins over what the workflow scan sees: keep
 * `detected` when it is itself required, else prefer a required context naming lockfile-assay
 * (the gate can report as an App check the YAML scan can't see). A detected job absent from a
 * readable required set is still seeded — requiredness can arrive later — but `notRequired`
 * flags it for a hand-off caveat. With `required` null (unreadable), nothing is asserted.
 */
export function resolveLockfileHonestyCheck(
  detected: string | null,
  required: string[] | null,
): { check: string | null; notRequired: boolean } {
  if (required === null) return { check: detected, notRequired: false };
  if (detected !== null && required.includes(detected))
    return { check: detected, notRequired: false };
  const fromRequired = required.find((c) => c.includes('lockfile-assay'));
  if (fromRequired !== undefined) return { check: fromRequired, notRequired: false };
  return { check: detected, notRequired: detected !== null };
}

function ciCaller(): string {
  return `# waiver-stamp producer — runs waiver-stamp as unprivileged pull_request CI, publishing the
# \`waiver-stamp\` check the reviewer consumes. The hardened shape lives in the pinned reusable
# workflow, not here. See docs/auto-approval-setup.md.
name: waiver-stamp-ci

on:
  pull_request:

permissions:
  contents: read

jobs:
  waiver-stamp:
    uses: jsalvata/waiver-stamp/.github/workflows/reusable-ci.yml@v${version}
`;
}

function reviewCaller(ciWorkflowNames: string[]): string {
  // waiver-stamp-ci is always in the trigger set; the adopter's CI names precede it. JSON-encoded
  // so a workflow name with a space or colon can't break the flow sequence.
  const workflows = JSON.stringify([...ciWorkflowNames, 'waiver-stamp-ci']);
  return `# waiver-stamp reviewer — the PRIVILEGED caller (holds pull-requests: write). Its
# security-load-bearing shape (the pwn-request defense) lives in the pinned reusable workflow it
# calls, not here. See docs/auto-approval-setup.md.
name: waiver-stamp-review

on:
  workflow_run:
    workflows: ${workflows}
    types: [completed]

permissions:
  pull-requests: write
  checks: read
  contents: read
  actions: read

jobs:
  review:
    uses: jsalvata/waiver-stamp/.github/workflows/reusable-review.yml@v${version}
    secrets:
      app_id: \${{ secrets.WAIVER_STAMP_APP_ID }}
      app_private_key: \${{ secrets.WAIVER_STAMP_APP_PRIVATE_KEY }}
`;
}

/** The current file at `abs`, or `null` if it isn't there. */
const currentContent = (abs: string): Promise<string | null> =>
  readFile(abs, 'utf8').then(
    (c) => c,
    () => null,
  );

/** Rewrite each 40-hex hash pin whose `# vX.Y.Z` marker names *this* version back to the tag pin
 *  it resolves to. Pins marked with any other version are left alone — that drift is real. */
const unpinCurrentVersion = (text: string): string =>
  text.replace(/@[0-9a-f]{40}(\s*#\s*)v(\d+\.\d+\.\d+)\b/g, (match, gap: string, ver: string) =>
    ver === version ? `@v${ver}${gap}v${ver}` : match,
  );

/** Whether `current` is our `intended` caller in substance: byte-equal, or equal once comments
 *  (inert in YAML) are dropped by parsing and same-version hash pins are read as the tag pins
 *  they mark — the two rewrites a zizmor-style hardening pass applies to an adopted caller. */
function isOurCaller(current: string, intended: string): boolean {
  if (current === intended) return true;
  try {
    return JSON.stringify(parse(unpinCurrentVersion(current))) === JSON.stringify(parse(intended));
  } catch {
    return false; // unparseable ⇒ not provably ours ⇒ keep the skip
  }
}

/**
 * Write the two caller workflows (§4.8), filling the reviewer's trigger with `ciWorkflowNames`.
 * Never clobbers a *different* file: an existing path whose content differs is recorded in `skipped`
 * and left byte-for-byte intact — clobbering the adopter's hand-tuned CI is not safe (§2.2). An
 * existing path that already holds our caller — byte-exact, or hardened per `isOurCaller` — counts
 * as `written`: it's a no-op we own (a prior partial run wrote it, or the callers are already
 * committed, perhaps hash-pinned by the repo's audit), not a foreign file to warn on.
 */
export async function writeCallerWorkflows(
  cwd: string,
  { ciWorkflowNames }: { ciWorkflowNames: string[] },
): Promise<{ written: string[]; skipped: string[] }> {
  await mkdir(join(cwd, '.github/workflows'), { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  const files: Array<[string, string]> = [
    [CI_CALLER, ciCaller()],
    [REVIEW_CALLER, reviewCaller(ciWorkflowNames)],
  ];
  for (const [rel, content] of files) {
    const abs = join(cwd, rel);
    const current = await currentContent(abs);
    if (current !== null && !isOurCaller(current, content)) {
      skipped.push(rel);
      continue;
    }
    if (current === null) await writeFile(abs, content);
    written.push(rel);
  }
  return { written, skipped };
}
