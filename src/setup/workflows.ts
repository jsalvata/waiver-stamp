import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Write the two caller workflows (§4.8), filling the reviewer's trigger with `ciWorkflowNames`.
 * Never overwrites: an existing path is recorded in `skipped` and left byte-for-byte intact — a
 * new file is safe, but clobbering the adopter's hand-tuned CI is not (§2.2).
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
    if (await exists(abs)) {
      skipped.push(rel);
      continue;
    }
    await writeFile(abs, content);
    written.push(rel);
  }
  return { written, skipped };
}
