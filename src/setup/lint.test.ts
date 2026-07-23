import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ESLINT_PACKAGE_JSON,
  FIXTURE_PACKAGE_JSON,
  scaffoldProject,
} from '../test-helpers.ts';
import { detectLintFixLinter } from './lint.ts';

const BOTH = `${JSON.stringify(
  { name: 'fixture', devDependencies: { '@biomejs/biome': '^1.9.4', eslint: '^9.0.0' } },
  null,
  2,
)}\n`;
const NEITHER = `${JSON.stringify({ name: 'fixture' }, null, 2)}\n`;

async function detect(pkg: string) {
  const { cwd, cleanup } = await scaffoldProject({ 'package.json': pkg });
  try {
    return await detectLintFixLinter(cwd);
  } finally {
    await cleanup();
  }
}

describe('detectLintFixLinter', () => {
  it('resolves when exactly one supported linter is declared (biome)', async () => {
    expect(await detect(FIXTURE_PACKAGE_JSON)).toEqual({
      status: 'resolved',
      declared: ['@biomejs/biome'],
    });
  });

  it('resolves when exactly one supported linter is declared (eslint)', async () => {
    expect(await detect(FIXTURE_ESLINT_PACKAGE_JSON)).toEqual({
      status: 'resolved',
      declared: ['eslint'],
    });
  });

  it('is ambiguous when more than one is declared', async () => {
    expect(await detect(BOTH)).toEqual({
      status: 'ambiguous',
      declared: ['@biomejs/biome', 'eslint'],
    });
  });

  it('is none when no supported linter is declared', async () => {
    expect(await detect(NEITHER)).toEqual({ status: 'none', declared: [] });
  });
});
