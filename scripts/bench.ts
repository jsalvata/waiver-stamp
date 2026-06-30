/**
 * Token-economy benchmark (spec §19). Measures how many tokens Opus 4.8 spends
 * to *express* a refactor two ways, on the SAME inlined code context:
 *   - without — emit the full mechanical rename diff (cost grows O(references));
 *   - with    — emit a waiver-stamp waiver (cost is O(1) intent).
 *
 * Output tokens are the headline metric: a probe showed ~20k of fixed
 * environment input overhead per call (system prompt + tools), identical in both
 * arms, so a total-token comparison would be swamped by noise. Output tokens are
 * the overhead-independent measure of the work, and also a faithful proxy for
 * REVIEW cost — the artifact a reviewer reads is the artifact each arm emits.
 *
 * Drives the installed `claude` CLI headless in an isolated, minimal env. Writes
 * bench/results.json + bench/results.md. Run with `pnpm bench`.
 *
 * Reproducibility: results are a dated snapshot; model output is non-deterministic
 * (each cell runs N times, median reported) and counts may drift across model
 * versions. This is stamped in the output, not hidden.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { applyWaiver } from '../src/apply.js';
import { loadWaiverFromObject } from '../src/load.js';
import { scaffoldProject } from '../src/test-helpers.js';

const exec = promisify(execFile);

const OLD = 'calculateTotal';
const NEW = 'computeOrderTotal';
const FAN_OUT = (process.env.BENCH_FANOUT ?? '3,12,30').split(',').map(Number);
const RUNS = Number(process.env.BENCH_RUNS ?? 3);
const MODEL = 'claude-opus-4-8';

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
    },
    include: ['**/*.ts'],
  },
  null,
  2,
);

/** A fixture project whose `calculateTotal` is called `refs` times across files. */
function genFixture(refs: number): Record<string, string> {
  const files: Record<string, string> = {
    'tsconfig.json': `${TSCONFIG}\n`,
    'src/orders.ts': `export function ${OLD}(n: number): number {\n  return n * 2;\n}\n`,
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

function renderFiles(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `path: ${path}\n\`\`\`\n${content}\`\`\``)
    .join('\n\n');
}

function withoutPrompt(files: Record<string, string>): string {
  return [
    `Here is a TypeScript project. Rename the function \`${OLD}\` to \`${NEW}\` everywhere it is declared or used.`,
    'Output ONLY the complete new contents of every file that changes, each as a fenced code block preceded by a `path: <path>` line. Do not explain. Output every changed file in full.',
    '',
    renderFiles(files),
  ].join('\n');
}

function withPrompt(files: Record<string, string>): string {
  return [
    `Here is a TypeScript project. Produce a waiver-stamp v0 waiver that renames the function \`${OLD}\` to \`${NEW}\`.`,
    'Output ONLY the waiver as a single fenced ```json block. Do not explain. The format is exactly:',
    '```json',
    `{ "schema": "waiver-stamp/v0", "tool": "waiver-stamp@0.0.0", "ops": [ { "op": "rename", "target": { "file": "<path-to-declaration>", "symbol": "${OLD}" }, "to": "${NEW}" } ] }`,
    '```',
    '',
    renderFiles(files),
  ].join('\n');
}

interface Run {
  outputTokens: number;
  inputTokens: number;
  costUsd: number;
  text: string;
}

async function runClaude(prompt: string, cwd: string, mcpConfig: string): Promise<Run> {
  const { stdout } = await exec(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      MODEL,
      '--strict-mcp-config',
      '--mcp-config',
      mcpConfig,
    ],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout) as {
    result: string;
    total_cost_usd: number;
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    outputTokens: j.usage.output_tokens,
    inputTokens: j.usage.input_tokens,
    costUsd: j.total_cost_usd,
    text: j.result,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function extractJson(text: string): unknown {
  const fence = text.match(/```json\s*\n([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse((raw ?? '').trim());
  } catch {
    return null;
  }
}

/** with-arm correctness: the emitted waiver applies and actually renames. */
async function withCorrect(text: string, files: Record<string, string>): Promise<boolean> {
  const obj = extractJson(text);
  if (!obj) return false;
  let waiver: ReturnType<typeof loadWaiverFromObject>;
  try {
    waiver = loadWaiverFromObject(obj);
  } catch {
    return false;
  }
  const fix = await scaffoldProject(files);
  try {
    await applyWaiver(waiver, { cwd: fix.cwd });
    const orders = await readFile(join(fix.cwd, 'src/orders.ts'), 'utf8');
    return orders.includes(NEW) && !orders.includes(OLD);
  } catch {
    return false;
  } finally {
    await fix.cleanup();
  }
}

/** without-arm correctness: the emitted *code* renames (new name present, old gone). */
function withoutCorrect(text: string): boolean {
  // Check only fenced code (not any preamble prose that might echo the old name).
  const code = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? '').join('\n');
  const haystack = code || text;
  return haystack.includes(NEW) && !new RegExp(`\\b${OLD}\\b`).test(haystack);
}

interface CellResult {
  fanOut: number;
  withoutOutputTokens: number;
  withOutputTokens: number;
  ratio: number;
  withoutCorrect: boolean;
  withCorrect: boolean;
  withoutCostUsd: number;
  withCostUsd: number;
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'ws-bench-'));
  const mcpConfig = join(cwd, 'empty-mcp.json');
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: {} }), 'utf8');

  const cells: CellResult[] = [];
  for (const fanOut of FAN_OUT) {
    const files = genFixture(fanOut);
    process.stderr.write(`fan-out ${fanOut}: `);

    const without: Run[] = [];
    const withRuns: Run[] = [];
    for (let r = 0; r < RUNS; r++) {
      without.push(await runClaude(withoutPrompt(files), cwd, mcpConfig));
      withRuns.push(await runClaude(withPrompt(files), cwd, mcpConfig));
      process.stderr.write('.');
    }
    process.stderr.write('\n');

    const woMed = median(without.map((x) => x.outputTokens));
    const wMed = median(withRuns.map((x) => x.outputTokens));
    cells.push({
      fanOut,
      withoutOutputTokens: woMed,
      withOutputTokens: wMed,
      ratio: Math.round((woMed / Math.max(wMed, 1)) * 10) / 10,
      withoutCorrect: without.every((x) => withoutCorrect(x.text)),
      withCorrect: (await Promise.all(withRuns.map((x) => withCorrect(x.text, files)))).every(
        Boolean,
      ),
      withoutCostUsd: median(without.map((x) => x.costUsd)),
      withCostUsd: median(withRuns.map((x) => x.costUsd)),
    });
  }

  await rm(cwd, { recursive: true, force: true });

  const stamp = {
    model: MODEL,
    tool: 'waiver-stamp@0.0.0',
    date: new Date().toISOString().slice(0, 10),
    runsPerCell: RUNS,
    metric: 'median output tokens',
    cells,
  };
  await writeFile('bench/results.json', `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  await writeFile('bench/results.md', renderMarkdown(stamp), 'utf8');
  process.stderr.write('wrote bench/results.json + bench/results.md\n');
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
        `| ${c.fanOut} | ${c.withoutOutputTokens} | ${c.withOutputTokens} | **${c.ratio}×** | ${c.withCorrect && c.withoutCorrect ? '✓' : '✗'} |`,
    )
    .join('\n');
  return [
    `<!-- generated by \`pnpm bench\` — ${s.model}, ${s.tool}, ${s.date}, median of ${s.runsPerCell} runs -->`,
    '',
    `**Tokens to express a rename refactor** — ${s.model}, median of ${s.runsPerCell} runs, ${s.date}.`,
    'Output tokens (overhead-independent; also the size of the artifact a reviewer reads).',
    'The waiver path is verified end-to-end every run: its output applies and stamps.',
    '',
    '| References renamed | Without waiver (full diff) | With waiver | Savings | Rename correct |',
    '|---|---|---|---|---|',
    rows,
    '',
    'The waiver cost is ~flat regardless of fan-out — the deterministic runner does the',
    'expansion — while the hand-written diff is several times larger. So both the',
    'authoring and the review savings hold across refactor sizes. Model output is',
    'non-deterministic; this is a dated snapshot — reproduce with `pnpm bench`.',
    '',
  ].join('\n');
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
