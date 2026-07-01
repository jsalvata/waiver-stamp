/**
 * Token-economy benchmark (spec §19). Measures how many tokens Opus 4.8 spends
 * to actually *make* the same rename two ways, on identical code context:
 *   - without — a normal agent with editing tools + a shell edits the files;
 *   - with    — an agent writes a waiver-stamp waiver and applies it via the
 *               `waiver_apply` MCP tool, letting the deterministic runner expand it.
 *
 * Both arms run the real task with real tools (no "print the files / print a
 * diff" strawman): each is dropped into a scaffolded project and told to perform
 * the rename, and we measure what it emits to get the job done.
 *
 * Output tokens are the headline metric: they are the overhead-independent measure
 * of the work and a faithful proxy for REVIEW cost (the artifact a reviewer reads).
 * For repeatability the child `claude` runs in an isolated CLAUDE_CONFIG_DIR (no
 * global CLAUDE.md, SessionStart hooks, plugins, or auto-loaded MCP), so the input
 * overhead is small and identical across both arms; we still report per-arm CONTEXT
 * size (input tokens at end) for reference. The isolated dir carries no credentials,
 * so ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) must be set.
 *
 * Correctness is checked by COMPILER EMIT against a ground-truth scoped rename
 * (the same oracle the stamper uses): the fixture is seeded with decoys — a
 * look-alike `calculateTotalTax` symbol and a same-named `calculateTotal` in an
 * `invoices` module — so a scope-blind edit (e.g. `sed`) that
 * corrupts them FAILs correctness while costing few tokens. The table therefore
 * reads honestly: cheap-and-safe (waiver) vs. what it actually costs an agent to
 * do the rename *safely*.
 *
 * Drives the installed `claude` CLI headless (stream-json). Writes
 * bench/results.json + bench/results.md. Run with `pnpm bench`.
 *
 * Cost/reproducibility: these are full agentic sessions, so a run drives the paid
 * `claude` CLI several turns per cell (N runs × fan-outs × 2 arms) — it is slow and
 * costs real money. Results are a dated snapshot; model output is non-deterministic
 * (mean ± sample stddev over N runs) and counts drift across model versions. This
 * is stamped in the output, not hidden.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { applyWaiver } from '../src/apply.js';
import { emitForFile } from '../src/engine/emit-compare.js';
import { loadProject } from '../src/engine/project.js';
import { loadWaiverFromObject } from '../src/load.js';
import { scaffoldProject } from '../src/test-helpers.js';

const exec = promisify(execFile);

const OLD = 'calculateTotal';
const NEW = 'computeOrderTotal';
/** Substring decoy: `s/calculateTotal/…/g` renames it too; a scoped rename won't. */
const LOOKALIKE = 'calculateTotalTax';
const FAN_OUT = (process.env.BENCH_FANOUT ?? '3,12,30').split(',').map(Number);
const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const MODEL = 'claude-opus-4-8';

/** Absolute path to the CLI entry, so the with-arm can spawn `waiver mcp` locally. */
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
/**
 * Absolute path to the local `tsx` binary. The MCP server is spawned by `claude`
 * with cwd = the (dependency-free) fixture dir, so `node --import tsx` can't
 * resolve `tsx` from there; invoking the resolved binary directly avoids that.
 */
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

/** Environment for the spawned `claude` processes; `main` isolates it (see below). */
let childEnv: NodeJS.ProcessEnv = process.env;

/** The known-correct scoped rename, used to build the emit oracle (ground truth). */
const REF_WAIVER = {
  schema: 'waiver-stamp/v0',
  tool: 'waiver-stamp@0.0.0',
  ops: [{ op: 'rename', target: { file: 'src/orders.ts', symbol: OLD }, to: NEW }],
} as const;

/**
 * A fixture project whose `calculateTotal` is called `refs` times across files,
 * seeded with two decoys a scope-blind edit would corrupt (see the emit oracle).
 */
function genFixture(refs: number): Record<string, string> {
  const files: Record<string, string> = {
    // The rename target and a look-alike whose name embeds OLD as a prefix (a
    // naive text substitution renames it too). No in-file hints — a natural trap.
    'src/orders.ts':
      `export function ${OLD}(n: number): number {\n  return n * 2;\n}\n\n` +
      `export function ${LOOKALIKE}(n: number): number {\n  return ${OLD}(n) * 1.1;\n}\n`,
    // A second module with its own, independent ${OLD} symbol. A scoped rename
    // leaves it; a word-boundary `sed` still corrupts it.
    'src/invoices.ts':
      `function ${OLD}(x: number): number {\n  return x + 1;\n}\n` +
      `export const invoiceTotal = ${OLD}(41);\n`,
  };
  const perFile = 4;
  let remaining = refs;
  let idx = 0;
  while (remaining > 0) {
    const k = Math.min(perFile, remaining);
    const lines = [`import { ${OLD} } from './orders';`, ''];
    for (let j = 0; j < k; j++) lines.push(`export const v${idx}_${j} = ${OLD}(${j + 1});`);
    files[`src/consumer${idx}.ts`] = `${lines.join('\n')}\n`;
    remaining -= k;
    idx++;
  }
  return files;
}

function withoutPrompt(): string {
  return [
    'This is a TypeScript project and you are in its root directory.',
    `Make a behaviour-preserving rename: rename the function \`${OLD}\` and all references to it to \`${NEW}\`, editing the files directly.`,
    'Do not use Skill, planning, brainstorming, or sub-agent tools — just make the edits, then stop.',
  ].join(' ');
}

function withPrompt(): string {
  return [
    'This is a TypeScript project and you are in its root directory.',
    `Make a behaviour-preserving rename of the function \`${OLD}\` (and all references) to \`${NEW}\`.`,
    'Do it by writing a waiver-stamp v0 waiver and applying it with the `waiver_apply` tool (from the waiver-stamp MCP server), which performs the rename deterministically. The waiver is exactly:',
    `{ "schema": "waiver-stamp/v0", "tool": "waiver-stamp@0.0.0", "ops": [ { "op": "rename", "target": { "file": "<file that declares ${OLD}>", "symbol": "${OLD}" }, "to": "${NEW}" } ] }`,
    'Call waiver_apply with that waiver object. Do not use Skill, planning, brainstorming, or sub-agent tools. When it is applied, stop.',
  ].join(' ');
}

interface Run {
  /** Total output tokens across every turn of the session (the work + review size). */
  outputTokens: number;
  /** Largest prompt context reached (input + cache), i.e. context size at the end. */
  contextTokens: number;
  costUsd: number;
}

/** A single stream-json event we care about (assistant usage / final result). */
interface StreamEvent {
  type?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  total_cost_usd?: number;
  modelUsage?: Record<string, { outputTokens?: number }>;
}

/** Raw captured output of one `claude` invocation, kept for post-hoc inspection. */
interface ClaudeOutput {
  stdout: string;
  stderr: string;
}

/** One headless `claude` invocation; rejects with the captured stderr on failure. */
async function execClaude(prompt: string, cwd: string, extraArgs: string[]): Promise<ClaudeOutput> {
  try {
    const { stdout, stderr } = await exec(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        MODEL,
        '--permission-mode',
        'auto',
        ...extraArgs,
      ],
      { cwd, env: childEnv, maxBuffer: 256 * 1024 * 1024, timeout: 300_000 },
    );
    return { stdout, stderr };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`claude failed: ${(e.stderr || e.stdout || e.message || '').slice(-800)}`);
  }
}

/** Drive `claude` headless in `cwd`, letting it use tools; sum the token usage.
 *  Retries a failed invocation twice — these are non-deterministic API sessions
 *  and an occasional transient failure shouldn't abort a long benchmark.
 *  If `transcriptRel` is given, the full raw stream-json stdout (and any stderr)
 *  of the successful attempt is written there for post-hoc inspection. */
async function runClaude(
  prompt: string,
  cwd: string,
  extraArgs: string[],
  transcriptRel?: string,
): Promise<Run> {
  let out: ClaudeOutput = { stdout: '', stderr: '' };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      out = await execClaude(prompt, cwd, extraArgs);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;

  if (transcriptRel) {
    // Deterministic filename → a re-run overwrites its own transcript in place;
    // we never clear the directory (see main), so checkpoint-resumed cells keep
    // the transcript written by their original run.
    await writeFile(transcriptRel, out.stdout, 'utf8');
    if (out.stderr.trim()) {
      await writeFile(transcriptRel.replace(/\.jsonl$/, '.stderr.log'), out.stderr, 'utf8');
    }
  }

  const { stdout } = out;
  let outputTokens = 0;
  let contextTokens = 0;
  let costUsd = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev: StreamEvent;
    try {
      ev = JSON.parse(t) as StreamEvent;
    } catch {
      continue;
    }
    if (ev.type === 'assistant') {
      const u = ev.message?.usage;
      if (u) {
        const ctx =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
        if (ctx > contextTokens) contextTokens = ctx;
      }
    } else if (ev.type === 'result') {
      costUsd = ev.total_cost_usd ?? 0;
      // modelUsage aggregates output across every turn of the session.
      for (const m of Object.values(ev.modelUsage ?? {})) outputTokens += m.outputTokens ?? 0;
    }
  }
  return { outputTokens, contextTokens, costUsd };
}

/** Sample stats (n-1 stddev; 0 for a single run). */
function meanStddev(xs: number[]): { mean: number; stddev: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  if (n < 2) return { mean, stddev: 0 };
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, stddev: Math.sqrt(variance) };
}

type Emits = { tsFiles: string[]; emits: Map<string, string> };

/** The ground-truth emit oracle: apply the reference scoped rename, tokenize emit. */
async function groundTruth(files: Record<string, string>): Promise<Emits> {
  const fix = await scaffoldProject(files);
  try {
    await applyWaiver(loadWaiverFromObject(REF_WAIVER), { cwd: fix.cwd });
    const project = loadProject(fix.cwd);
    const tsFiles = Object.keys(files).filter((f) => f.endsWith('.ts'));
    const emits = new Map(tsFiles.map((rel) => [rel, emitForFile(project, join(fix.cwd, rel))]));
    return { tsFiles, emits };
  } finally {
    await fix.cleanup();
  }
}

/** The agent's mutated tree is correct iff every file's emit equals the oracle's. */
function agentCorrect(cwd: string, gt: Emits): boolean {
  try {
    const project = loadProject(cwd);
    return gt.tsFiles.every((rel) => emitForFile(project, join(cwd, rel)) === gt.emits.get(rel));
  } catch {
    return false;
  }
}

/** Run one arm: scaffold a fresh tree, let the agent edit it, score correctness.
 *  `transcriptRel` names where this run's raw session output is persisted. */
async function runArm(
  prompt: string,
  files: Record<string, string>,
  gt: Emits,
  mcpConfig: string,
  transcriptRel: string,
): Promise<ArmResult> {
  const fix = await scaffoldProject(files);
  try {
    const run = await runClaude(
      prompt,
      fix.cwd,
      ['--strict-mcp-config', '--mcp-config', mcpConfig],
      transcriptRel,
    );
    return { run, ok: agentCorrect(fix.cwd, gt), transcript: transcriptRel };
  } finally {
    await fix.cleanup();
  }
}

interface CellResult {
  fanOut: number;
  withoutOutput: { mean: number; stddev: number };
  withOutput: { mean: number; stddev: number };
  ratio: number;
  withoutContext: number;
  withContext: number;
  withoutCorrect: boolean;
  withCorrect: boolean;
  withoutCostUsd: number;
  withCostUsd: number;
}

/** One arm-run's measured result — the unit the checkpoint caches.
 *  `transcript` is the repo-relative path to this run's persisted raw session. */
type ArmResult = { run: Run; ok: boolean; transcript?: string };

/** On-disk checkpoint so a teardown mid-benchmark resumes rather than restarting. */
interface Cache {
  sig: string;
  entries: Record<string, ArmResult>;
}

/** Bench runs are expensive agentic sessions; persist each so a kill costs ≤1. */
const CACHE = 'bench/.bench-cache.json';
/** Bump/parameterize to invalidate a stale checkpoint (e.g. on a model change). */
const CACHE_SIG = MODEL;

/** Per-run raw session transcripts + their outcome index, for post-hoc inspection. */
const TRANSCRIPTS = 'bench/transcripts';

async function loadCache(): Promise<Cache> {
  const fresh: Cache = { sig: CACHE_SIG, entries: {} };
  try {
    const c = JSON.parse(await readFile(CACHE, 'utf8')) as Cache;
    return c.sig === CACHE_SIG ? c : fresh;
  } catch {
    return fresh;
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await writeFile(CACHE, `${JSON.stringify(cache)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'ws-bench-'));

  // Repeatability: run the child `claude` in an isolated CLAUDE_CONFIG_DIR so it
  // sees no global CLAUDE.md, SessionStart hooks, plugins, or auto-loaded MCP
  // servers — only what we pass. The empty config dir has no stored credentials,
  // so a token must supply auth.
  const token = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    throw new Error(
      'set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) so the isolated benchmark can ' +
        'authenticate; the isolated CLAUDE_CONFIG_DIR carries no stored credentials.',
    );
  }
  const configDir = join(tmp, 'claude-config');
  await mkdir(configDir);
  childEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };

  const emptyMcp = join(tmp, 'empty-mcp.json');
  const waiverMcp = join(tmp, 'waiver-mcp.json');
  await writeFile(emptyMcp, JSON.stringify({ mcpServers: {} }), 'utf8');
  await writeFile(
    waiverMcp,
    JSON.stringify({
      mcpServers: {
        'waiver-stamp': { command: TSX, args: [CLI, 'mcp'] },
      },
    }),
    'utf8',
  );

  // Keep transcripts across runs rather than clearing: filenames are deterministic
  // (fanN-arm-runR.jsonl), so a fresh run overwrites its own cells in place, while
  // checkpoint-resumed cells — which don't re-invoke `claude` — retain the
  // transcript their original run wrote. Clearing here would orphan those.
  await mkdir(TRANSCRIPTS, { recursive: true });

  const cache = await loadCache();
  const cells: CellResult[] = [];
  for (const fanOut of FAN_OUT) {
    const files = genFixture(fanOut);
    const gt = await groundTruth(files);
    process.stderr.write(`fan-out ${fanOut}: `);

    const arms = [
      { name: 'without', prompt: withoutPrompt(), mcp: emptyMcp },
      { name: 'with', prompt: withPrompt(), mcp: waiverMcp },
    ] as const;

    for (let r = 0; r < RUNS; r++) {
      for (const arm of arms) {
        const key = `${fanOut}|${arm.name}|${r}`;
        if (cache.entries[key]) {
          process.stderr.write('='); // resumed from checkpoint (keeps its old transcript)
        } else {
          const transcriptRel = `${TRANSCRIPTS}/fan${fanOut}-${arm.name}-run${r}.jsonl`;
          cache.entries[key] = await runArm(arm.prompt, files, gt, arm.mcp, transcriptRel);
          await saveCache(cache);
          process.stderr.write('.');
        }
      }
    }
    process.stderr.write('\n');

    const pick = (name: string): ArmResult[] =>
      Array.from({ length: RUNS }, (_, r) => cache.entries[`${fanOut}|${name}|${r}`]).filter(
        (e): e is ArmResult => Boolean(e),
      );
    const without = pick('without');
    const withRuns = pick('with');
    const woOut = meanStddev(without.map((x) => x.run.outputTokens));
    const wOut = meanStddev(withRuns.map((x) => x.run.outputTokens));
    cells.push({
      fanOut,
      withoutOutput: woOut,
      withOutput: wOut,
      ratio: Math.round((woOut.mean / Math.max(wOut.mean, 1)) * 10) / 10,
      withoutContext: Math.round(meanStddev(without.map((x) => x.run.contextTokens)).mean),
      withContext: Math.round(meanStddev(withRuns.map((x) => x.run.contextTokens)).mean),
      withoutCorrect: without.every((x) => x.ok),
      withCorrect: withRuns.every((x) => x.ok),
      withoutCostUsd: meanStddev(without.map((x) => x.run.costUsd)).mean,
      withCostUsd: meanStddev(withRuns.map((x) => x.run.costUsd)).mean,
    });
  }

  // Outcome index: one row per arm-run, so the surprising cell (failed correctness
  // or outlier tokens) can be spotted and its transcript opened directly. Built from
  // the cache, so it covers freshly-run and checkpoint-resumed cells alike.
  const index = Object.entries(cache.entries).map(([k, res]) => {
    const [fanOut, arm, run] = k.split('|');
    return {
      fanOut: Number(fanOut),
      arm,
      run: Number(run),
      transcript: res.transcript ?? null,
      outputTokens: res.run.outputTokens,
      contextTokens: res.run.contextTokens,
      costUsd: res.run.costUsd,
      ok: res.ok,
    };
  });
  await writeFile(`${TRANSCRIPTS}/index.json`, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  await rm(tmp, { recursive: true, force: true });
  await rm(CACHE, { force: true }); // completed cleanly — drop the checkpoint

  const stamp = {
    model: MODEL,
    tool: 'waiver-stamp@0.0.0',
    date: new Date().toISOString().slice(0, 10),
    runsPerCell: RUNS,
    metric: 'output tokens to make the change with tools (mean ± sample stddev)',
    cells,
  };
  await writeFile('bench/results.json', `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  await writeFile('bench/results.md', renderMarkdown(stamp), 'utf8');
  process.stderr.write('wrote bench/results.json + bench/results.md\n');
}

function fmt(m: { mean: number; stddev: number }): string {
  return `${Math.round(m.mean)} ± ${m.stddev.toFixed(1)}`;
}

function renderMarkdown(s: {
  model: string;
  tool: string;
  date: string;
  runsPerCell: number;
  cells: CellResult[];
}): string {
  const rows = s.cells
    .map(
      (c) =>
        `| ${c.fanOut} | ${fmt(c.withoutOutput)} | ${fmt(c.withOutput)} | **${c.ratio}×** | ${c.withoutContext} | ${c.withContext} | ${c.withCorrect && c.withoutCorrect ? '✓' : '✗'} |`,
    )
    .join('\n');
  return [
    `<!-- generated by \`pnpm bench\` — ${s.model}, ${s.tool}, ${s.date}, mean ± stddev of ${s.runsPerCell} runs -->`,
    '',
    `**Tokens to make a rename refactor** — ${s.model}, mean ± sample stddev of ${s.runsPerCell} runs, ${s.date}.`,
    'Both arms *make the change* with real tools: the without-arm edits the files (editing tools + a shell);',
    'the with-arm writes a waiver and applies it via the `waiver_apply` MCP tool. Output tokens are the',
    'overhead-independent measure of the work and the size of the artifact a reviewer reads.',
    '',
    '| References renamed | Without waiver, output (mean±sd) | With waiver, output (mean±sd) | Savings | Without context | With context | Both correct |',
    '|---|---|---|---|---|---|---|',
    rows,
    '',
    'Correctness is by compiler emit against a ground-truth scoped rename; the fixture seeds decoys (a',
    '`calculateTotalTax` look-alike and a same-named `calculateTotal` in an invoices module) so a scope-blind',
    'edit FAILs. Context is input tokens at end; the child `claude` runs in an isolated config dir, so that',
    'overhead is small and identical across both arms. Model output is non-deterministic; this is a dated',
    'snapshot — reproduce with `pnpm bench` (needs ANTHROPIC_API_KEY for the isolated run).',
    '',
  ].join('\n');
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
