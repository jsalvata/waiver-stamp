#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { apply } from './apply.js';
import { check } from './check.js';
import { NotImplementedError, WaiverParseError, WaiverValidationError } from './errors.js';
import { EXIT, type ExitCode } from './report.js';
import { stamp } from './stamp.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

/** Run a command body, mapping its outcome to the §10 exit-code contract. */
async function run(body: () => Promise<unknown>): Promise<void> {
  try {
    await body();
    setExit(EXIT.STAMPED);
  } catch (err) {
    if (err instanceof WaiverParseError) {
      console.error(`error: ${err.path} is not valid JSON`);
      setExit(EXIT.MALFORMED);
    } else if (err instanceof WaiverValidationError) {
      console.error('error: waiver failed schema validation');
      for (const e of err.errors) console.error(`  - ${e}`);
      setExit(EXIT.MALFORMED);
    } else if (err instanceof NotImplementedError) {
      console.error(`error: '${err.feature}' is not implemented in the v0 scaffold`);
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
    await run(() => apply(waiver, { cwd: process.cwd() }));
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
      const report = await stamp(waiver, { base: opts.base, head: opts.head });
      if (opts.json) console.log(JSON.stringify(report, null, 2));
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

await program.parseAsync(process.argv);
