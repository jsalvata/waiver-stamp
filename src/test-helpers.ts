/**
 * Shared test fixtures. Excluded from the published build (tsconfig.build.json)
 * — it is only imported by `*.test.ts`. Scaffolds a throwaway ts-morph-loadable
 * project on disk so engine tests run against a real tsconfig + real files.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Fixture {
  /** Absolute path to the temp project root (holds tsconfig.json). */
  cwd: string;
  /** Remove the temp project. */
  cleanup: () => Promise<void>;
}

const DEFAULT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    // Bundler resolution lets fixtures use extensionless relative imports.
    moduleResolution: 'Bundler',
    strict: true,
    declaration: false,
    skipLibCheck: true,
  },
  include: ['**/*.ts'],
};

/** Write `files` (path → content) plus a tsconfig into a fresh temp dir. */
export async function scaffoldProject(
  files: Record<string, string>,
  tsconfig: unknown = DEFAULT_TSCONFIG,
): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'ws-fix-'));
  await writeFile(join(cwd, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(cwd, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return { cwd, cleanup: () => rm(cwd, { recursive: true, force: true }) };
}
