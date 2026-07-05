import * as core from '@actions/core';

export async function run(): Promise<void> {
  core.info('waiver-stamp-review: not yet implemented');
}

// ncc entry: invoke unless imported by a test.
if (process.env.VITEST === undefined) {
  run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
}
