#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { apply } from './apply.js';
import {
  CommitResolutionError,
  NotImplementedError,
  WaiverParseError,
  WaiverValidationError,
} from './errors.js';
import { startMcpServer } from './mcp.js';
import { EXIT, type ExitCode } from './report.js';
import { stamp } from './stamp.js';
import { verify } from './verify.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

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
    } else if (err instanceof CommitResolutionError) {
      console.error(`error: '${err.ref}' does not resolve to a commit`);
      setExit(EXIT.MALFORMED);
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
  .argument('<waiver>', 'path to the waiver JSON file, or `-` for stdin')
  .description("apply a waiver's transform ops to the working tree")
  .action(async (waiver: string) => {
    await run(async () => {
      const { files } = await apply(waiver, { cwd: process.cwd() });
      console.log(`applied: ${files.length} file(s) changed`);
      for (const f of files) console.log(`  ${f}`);
    });
  });

program
  .command('verify')
  .argument('[commit]', 'commit-ish to verify (default HEAD)')
  .option('--json', 'emit a machine-readable report')
  .description('verify one commit against its embedded waiver (§17.4)')
  .action(async (commit: string | undefined, opts: { json?: boolean }) => {
    await run(async () => {
      const r = await verify({ commit, cwd: process.cwd() });
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`${r.class.padEnd(10)} ${r.sha.slice(0, 8)} ${r.subject}`);
        for (const reason of r.reasons) console.log(`  - ${reason}`);
      }
      if (r.class === 'invalid' || r.class === 'unwaivered') setExit(EXIT.FAILURE);
      // stamped / skipped → default STAMPED (0)
    });
  });

program
  .command('stamp')
  .requiredOption('--base <ref>', 'base git ref')
  .requiredOption('--head <ref>', 'head git ref')
  .option('--json', 'emit a machine-readable report')
  .description('aggregate the per-commit PR verdict over base..head (§17.2)')
  .action(async (opts: { base: string; head: string; json?: boolean }) => {
    await run(async () => {
      const report = await stamp({ base: opts.base, head: opts.head, cwd: process.cwd() });
      if (opts.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`verdict: ${report.verdict}`);
        for (const c of report.commits) console.log(`  ${c.sha.slice(0, 8)} ${c.class.padEnd(10)} ${c.subject}`);
      }
      if (report.verdict === 'REQUEST_CHANGES') setExit(EXIT.FAILURE);
    });
  });

program
  .command('mcp')
  .description('run the stdio MCP server exposing the engine as tools (§18.1)')
  .action(async () => {
    await startMcpServer(version);
  });

await program.parseAsync(process.argv);
