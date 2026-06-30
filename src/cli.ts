#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { apply } from './apply.js';
import { check } from './check.js';
import { commitWaiver } from './commit.js';
import {
  DirtyTreeError,
  NotImplementedError,
  ToolMismatchError,
  WaiverParseError,
  WaiverValidationError,
} from './errors.js';
import { startMcpServer } from './mcp.js';
import { EXIT, type ExitCode } from './report.js';
import { stamp } from './stamp.js';
import { verify } from './verify.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const TOOL = `waiver-stamp@${version}`;

/** Run a command body, mapping its outcome to the §10 / §17.2 exit-code contract. */
async function run(body: () => Promise<void>): Promise<void> {
  try {
    await body();
    if (process.exitCode === undefined) setExit(EXIT.STAMPED);
  } catch (err) {
    if (err instanceof WaiverParseError) {
      console.error(`error: ${err.path} is not valid JSON`);
      setExit(EXIT.MALFORMED);
    } else if (err instanceof WaiverValidationError) {
      console.error('error: waiver failed schema validation');
      for (const e of err.errors) console.error(`  - ${e}`);
      setExit(EXIT.MALFORMED);
    } else if (err instanceof ToolMismatchError) {
      console.error(`error: waiver pins ${err.waiverTool} but this tool is ${err.runningTool}`);
      setExit(EXIT.MALFORMED);
    } else if (err instanceof DirtyTreeError) {
      console.error('error: working tree has tracked changes; commit or stash them first');
      setExit(EXIT.FAILURE);
    } else if (err instanceof NotImplementedError) {
      console.error(`error: '${err.feature}' is not implemented in v0`);
      setExit(EXIT.INTERNAL);
    } else {
      console.error(`internal error: ${err instanceof Error ? err.message : String(err)}`);
      setExit(EXIT.INTERNAL);
    }
  }
}

function setExit(code: ExitCode): void {
  process.exitCode = code;
}

const program = new Command();

program
  .name('waiver')
  .description('waiver-stamp — auto-approve PRs whose safety can be proven mechanically')
  .version(version);

program
  .command('apply')
  .argument('<waiver>', 'path to the waiver JSON file')
  .description("apply a waiver's transform ops to the working tree")
  .action(async (waiver: string) => {
    await run(async () => {
      const { files } = await apply(waiver, { cwd: process.cwd() });
      console.log(`applied: ${files.length} file(s) changed`);
      for (const f of files) console.log(`  ${f}`);
    });
  });

program
  .command('stamp')
  .argument('<waiver>', 'path to the waiver JSON file')
  .requiredOption('--base <ref>', 'base git ref')
  .requiredOption('--head <ref>', 'head git ref')
  .option('--json', 'emit a machine-readable JSON report')
  .description("validate a PR's diff against its waiver")
  .action(async (waiver: string, opts: { base: string; head: string; json?: boolean }) => {
    await run(async () => {
      const report = await stamp(waiver, {
        base: opts.base,
        head: opts.head,
        cwd: process.cwd(),
        tool: TOOL,
      });
      if (opts.json) console.log(JSON.stringify(report, null, 2));
      else console.log(report.stamped ? 'STAMPED' : `FAILED: ${report.failures.join('; ')}`);
      if (!report.stamped) setExit(EXIT.FAILURE);
    });
  });

program
  .command('verify')
  .requiredOption('--base <ref>', 'base git ref')
  .requiredOption('--head <ref>', 'head git ref')
  .option('--json', 'emit a machine-readable JSON report')
  .description('per-commit verdict over a PR range (§17.2)')
  .action(async (opts: { base: string; head: string; json?: boolean }) => {
    await run(async () => {
      const report = await verify({
        base: opts.base,
        head: opts.head,
        cwd: process.cwd(),
        tool: TOOL,
      });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`verdict: ${report.verdict}`);
        for (const c of report.commits) {
          console.log(`  ${c.sha.slice(0, 8)} ${c.class.padEnd(10)} ${c.subject}`);
        }
      }
      if (report.verdict === 'REQUEST_CHANGES') setExit(EXIT.FAILURE);
    });
  });

program
  .command('commit')
  .argument('<waiver>', 'path to the waiver JSON file')
  .option('-m, --message <subject>', 'commit subject line')
  .description('apply a waiver and commit it with the waiver embedded (§17.4)')
  .action(async (waiver: string, opts: { message?: string }) => {
    await run(async () => {
      const { sha } = await commitWaiver(waiver, { subject: opts.message, cwd: process.cwd() });
      console.log(`committed ${sha.slice(0, 8)}`);
    });
  });

program
  .command('check')
  .argument('<waiver>', 'path to the waiver JSON file')
  .option('--json', 'emit machine-readable output')
  .description('schema + static-guard validation only (fast lint)')
  .action(async (waiver: string, opts: { json?: boolean }) => {
    await run(async () => {
      const result = await check(waiver);
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else
        console.log(
          `ok: ${waiver} is a valid waiver-stamp/${result.waiver.schema.split('/')[1]} waiver`,
        );
    });
  });

program
  .command('mcp')
  .description('run the stdio MCP server exposing the engine as tools (§18.1)')
  .action(async () => {
    await startMcpServer(TOOL);
  });

await program.parseAsync(process.argv);
