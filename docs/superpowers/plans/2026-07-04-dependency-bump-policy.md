# Dependency-Bump Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unimplemented `bump` op with a standing per-repo dependency-bump policy (spec §6.3): when a waivered commit changes `package.json`/`pnpm-lock.yaml`, those files are *covered* iff the change is allowlisted, up-moving, plain-semver, confined, and the lockfile honestly re-resolves.

**Architecture:** `bump` leaves the op vocabulary entirely. A new `src/engine/deps.ts` module holds pure gates (`matchesAllowlist`, `manifestBumpViolations`) plus an async evaluator that re-resolves the lockfile. `validateCommit` runs the evaluator as a standing pass during the compare — no op dispatch. The allowlist lives in `.waiver-stamp.json` (read from base); absent → feature off.

**Tech Stack:** TypeScript ESM (`.js` import suffixes), Zod v4 (`zod/v4`), `semver` (new dep), vitest, `node:child_process`/`fs`.

## Global Constraints

- Commands: `pnpm test`, `pnpm typecheck`, `pnpm lint` (Biome) — green at the end of every task. `pnpm gen:schema` regenerates the published JSON Schema.
- Commit rules (git-commit skill): prefixes `feat:`/`fix:`/`docs:` only, all lowercase, header ≤ 50 chars, no ticket trailer. **Never commit between Mon–Fri 09:00–18:00 (+0200)** — run `date '+%A %H:%M %z'` first; inside the window, stop and report.
- Errors: data in structured properties (`OpApplicationError(opKind, detail)`), never interpolated into `message`.
- ESM: all local imports use `.js` suffix; Zod from `'zod/v4'`.
- Config file: `.waiver-stamp.json` at repo root, key `allowBumping` (camelCase), read from **base**. Absent/empty → feature off (package.json changes fall to review).
- The policy runs only inside `validateCommit` (waivered commits); an unwaivered commit is `unwaivered` regardless of deps. A pure dep-bump commit needs an embedded empty waiver `{ "schema": "waiver-stamp/v0", "ops": [] }`.
- Coverage rule (spec §6.3): allowlisted + plain-semver + up-moving (head admits no version below base's floor) + confined manifest diff (only version strings of existing deps change) + honest lockfile re-resolve (`pnpm install --lockfile-only --ignore-scripts --prefer-frozen-lockfile`).

## File Structure

- `src/schema.ts` — **modify**: delete `BumpOpSchema` + its union member.
- `src/types.ts` — **modify**: delete `BumpOp` type, its import, and `'bump'` from `TRANSFORM_OP_KINDS`.
- `src/engine/fold.ts` — **modify**: drop the `case 'bump'` arm.
- `schema/waiver-stamp.v0.schema.json` — **regenerated** by `pnpm gen:schema`.
- `src/engine/deps.ts` — **create**: the whole dependency-bump policy (pure gates + config loader + resolver + evaluator + `coverDependencyBump`).
- `src/engine/deps.test.ts` — **create**: unit tests (pure gates) + integration tests (via `validateCommit`, fake resolver).
- `src/validate-commit.ts` — **modify**: `ValidateOptions.resolveLockfile` seam; run `coverDependencyBump` in the compare.
- `README.md`, `plugin/skills/refactor-with-waiver/SKILL.md` — **modify**: docs.
- `package.json` — **modify**: add `semver` + `@types/semver`.

---

### Task 1: Remove the `bump` op from the vocabulary

Pure removal — `bump` was never implemented (it threw "not yet implemented"). No test references it. The drift-guard test forces the regenerated JSON Schema.

**Files:**
- Modify: `src/schema.ts`
- Modify: `src/types.ts`
- Modify: `src/engine/fold.ts`
- Regenerate: `schema/waiver-stamp.v0.schema.json`

**Interfaces:**
- Produces: `Op` union and `OpKind` no longer include `'bump'`; `BumpOp`/`BumpOpSchema` are gone. Task 3 relies on `'bump'` being absent from the `fold.ts` switch.

- [ ] **Step 1: Delete `BumpOpSchema` from `src/schema.ts`**

Remove this block (the "Transform · transitive" schema, currently ~lines 93–101):

```ts
// ── Transform · transitive ───────────────────────────────────────────────────

export const BumpOpSchema = z
  .object({
    op: z.literal('bump'),
    packages: z.array(nonEmpty).min(1),
  })
  .strict()
  .describe('Bump allowlisted dependency versions (manifest + lockfile only).');
```

And remove `BumpOpSchema,` from the `OpSchema` discriminated union:

```ts
export const OpSchema = z.discriminatedUnion('op', [
  RenameOpSchema,
  ExtractFunctionOpSchema,
  MoveToNewFileOpSchema,
  MoveFileOpSchema,
  ChangeTestOpSchema,
  ChangeDocsOpSchema,
]);
```

(If a `LintFixOpSchema` member is present in the union, keep it — only `BumpOpSchema` is removed.)

- [ ] **Step 2: Delete `BumpOp` from `src/types.ts`**

Remove `BumpOpSchema,` from the import list, remove the line `export type BumpOp = z.infer<typeof BumpOpSchema>;`, and remove `'bump',` from `TRANSFORM_OP_KINDS`:

```ts
export const TRANSFORM_OP_KINDS = [
  'rename',
  'extract-function',
  'move-to-new-file',
  'move-file',
] as const satisfies readonly OpKind[];
```

- [ ] **Step 3: Drop the `case 'bump'` arm in `src/engine/fold.ts`**

The current arm is:

```ts
    case 'extract-function':
    case 'move-to-new-file':
    case 'bump':
      throw new OpApplicationError(op.op, 'not yet implemented in v0');
```

Change to:

```ts
    case 'extract-function':
    case 'move-to-new-file':
      throw new OpApplicationError(op.op, 'not yet implemented in v0');
```

- [ ] **Step 4: Regenerate the JSON Schema**

Run: `pnpm gen:schema`
Expected: `wrote …/schema/waiver-stamp.v0.schema.json` (the `bump` definition disappears from the file).

- [ ] **Step 5: Verify green**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass. The drift-guard test in `src/schema.test.ts` passes because the committed JSON now matches the Zod output.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/types.ts src/engine/fold.ts schema/waiver-stamp.v0.schema.json
git commit -m "feat: drop the unimplemented bump op"
```

---

### Task 2: `semver` + the pure policy gates

TDD. `matchesAllowlist` and `manifestBumpViolations` are pure and fully offline — the heart of the confinement/shape/up-moving checks. No wiring yet.

**Files:**
- Modify: `package.json` (add `semver`, `@types/semver`)
- Create: `src/engine/deps.ts`
- Create: `src/engine/deps.test.ts`

**Interfaces:**
- Produces: `matchesAllowlist(pkg: string, allowlist: readonly string[]): boolean`; `manifestBumpViolations(base: Record<string, unknown>, head: Record<string, unknown>, allowlist: readonly string[]): string[]`. Task 3 builds the evaluator on these.

- [ ] **Step 1: Add `semver`**

Run: `pnpm add semver && pnpm add -D @types/semver`
Expected: `semver` in `dependencies`, `@types/semver` in `devDependencies`.

- [ ] **Step 2: Write the failing tests** — `src/engine/deps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { manifestBumpViolations, matchesAllowlist } from './deps.js';

describe('matchesAllowlist', () => {
  it('matches exact names', () => {
    expect(matchesAllowlist('lodash', ['lodash'])).toBe(true);
    expect(matchesAllowlist('lodash-es', ['lodash'])).toBe(false);
  });

  it('matches `@scope/*` as a scope prefix', () => {
    expect(matchesAllowlist('@myorg/foo', ['@myorg/*'])).toBe(true);
    expect(matchesAllowlist('@myorg-evil/foo', ['@myorg/*'])).toBe(false);
    expect(matchesAllowlist('@myorg', ['@myorg/*'])).toBe(false);
  });
});

describe('manifestBumpViolations', () => {
  const allow = ['lodash', '@myorg/*'];
  const base = {
    name: 'fixture',
    dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0' },
    devDependencies: { '@myorg/a': '1.0.0' },
    scripts: { build: 'tsc' },
  };

  it('accepts an allowlisted up-move (caret major bump)', () => {
    const head = { ...base, dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts an exact-pin up-move', () => {
    const head = { ...base, dependencies: { lodash: '1.5.0', 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([]);
  });

  it('accepts identical manifests', () => {
    expect(manifestBumpViolations(base, base, allow)).toEqual([]);
  });

  it('rejects a change to a non-allowlisted package', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'left-pad' is not on allowBumping",
    ]);
  });

  it('rejects an added dependency', () => {
    const head = {
      ...base,
      dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0', '@myorg/new': '1.0.0' },
    };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: '@myorg/new' added",
    ]);
  });

  it('rejects a removed dependency', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'left-pad' removed",
    ]);
  });

  it('rejects a change to a non-dependency field', () => {
    const head = { ...base, scripts: { build: 'tsc', evil: 'curl x | sh' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual(["field 'scripts' changed"]);
  });

  it('rejects a downward move (widening below base floor)', () => {
    const head = { ...base, dependencies: { lodash: '>=0.1.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a re-widening union that re-admits low versions', () => {
    const head = { ...base, dependencies: { lodash: '^1.0.0 || >=0.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('below base floor');
  });

  it('rejects a protocol/alias specifier (not plain semver)', () => {
    const head = { ...base, dependencies: { lodash: 'npm:evil@1.0.0', 'left-pad': '^1.0.0' } };
    const v = manifestBumpViolations(base, head, allow);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('not plain semver');
  });

  it('rejects a non-string version value', () => {
    const head = { ...base, dependencies: { lodash: { evil: true }, 'left-pad': '^1.0.0' } };
    expect(manifestBumpViolations(base, head, allow)).toEqual([
      "dependencies: 'lodash' is not a version string",
    ]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/engine/deps.test.ts`
Expected: FAIL — cannot resolve `./deps.js`.

- [ ] **Step 4: Implement the pure gates** — `src/engine/deps.ts`:

```ts
/**
 * The standing dependency-bump policy (spec §6.3). Not a waiver op: when a waivered
 * commit changes `package.json`/lockfile, these gates decide whether the change is a
 * covered bump — allowlisted, plain-semver, up-moving, confined — and the lockfile
 * honestly re-resolves. Trusts upstream review of the bumped package; not
 * behaviour-preserving.
 */

import semver from 'semver';

/** Dependency blocks whose version-string values a bump may change. */
const DEP_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** `@scope/*` entries are scope prefixes; all others match a package name exactly (§6.3). */
export function matchesAllowlist(pkg: string, allowlist: readonly string[]): boolean {
  return allowlist.some((e) => (e.endsWith('/*') ? pkg.startsWith(e.slice(0, -1)) : pkg === e));
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * The bump envelope, fail-closed: base and head manifests must be identical except
 * version-string values in {@link DEP_BLOCKS}, for allowlisted packages, moving up
 * (head admits no version below base's floor) and staying plain semver.
 */
export function manifestBumpViolations(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  allowlist: readonly string[],
): string[] {
  const violations: string[] = [];
  const blocks: readonly string[] = DEP_BLOCKS;
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (blocks.includes(key)) {
      violations.push(...blockViolations(key, asRecord(base[key]), asRecord(head[key]), allowlist));
    } else if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      violations.push(`field '${key}' changed`);
    }
  }
  return violations;
}

function blockViolations(
  block: string,
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  allowlist: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const pkg of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const a = base[pkg];
    const b = head[pkg];
    if (a === undefined) {
      violations.push(`${block}: '${pkg}' added`);
    } else if (b === undefined) {
      violations.push(`${block}: '${pkg}' removed`);
    } else if (a !== b) {
      if (!matchesAllowlist(pkg, allowlist)) {
        violations.push(`${block}: '${pkg}' is not on allowBumping`);
      } else if (typeof a !== 'string' || typeof b !== 'string') {
        violations.push(`${block}: '${pkg}' is not a version string`);
      } else {
        const move = versionMoveViolation(pkg, a, b);
        if (move) violations.push(`${block}: ${move}`);
      }
    }
  }
  return violations;
}

/**
 * `null` if `head` is a plain-semver *up-move* of `base` (head admits no version below
 * base's floor); otherwise a reason. Non-semver specifiers (`npm:`/`git:`/`catalog:`/…)
 * fail `validRange` → rejected. Fail-closed: an undecidable subset is a violation.
 */
function versionMoveViolation(pkg: string, base: string, head: string): string | null {
  const baseRange = semver.validRange(base);
  const headRange = semver.validRange(head);
  if (!baseRange) return `'${pkg}' base version '${base}' is not plain semver`;
  if (!headRange) return `'${pkg}' new version '${head}' is not plain semver`;
  const floor = semver.minVersion(baseRange);
  if (!floor) return `'${pkg}' base range '${base}' has no floor`;
  let up = false;
  try {
    up = semver.subset(headRange, `>=${floor.version}`, { includePrerelease: true });
  } catch {
    return `'${pkg}' move '${base}' → '${head}' is not decidable`;
  }
  if (!up) return `'${pkg}' new version '${head}' admits versions below base floor ${floor.version}`;
  return null;
}
```

Note: `import semver from 'semver'` (default import — `semver` is CommonJS; the named functions `validRange`/`minVersion`/`subset` hang off the default export). If the build rejects the default import, fall back to subpath imports (`import subset from 'semver/functions/subset.js'`, etc.).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/engine/deps.test.ts`
Expected: PASS (all `matchesAllowlist` + `manifestBumpViolations` tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/engine/deps.ts src/engine/deps.test.ts
git commit -m "feat: dependency-bump confinement gates"
```

---

### Task 3: Evaluator + resolver + wire into `validateCommit`

TDD: integration tests through `validateCommit` with a fake resolver first, then the evaluator and the wiring.

**Files:**
- Modify: `src/engine/deps.ts` (add `resolvePnpmLockfile`, `coverDependencyBump`, config loader)
- Modify: `src/engine/deps.test.ts` (add integration tests)
- Modify: `src/validate-commit.ts` (`resolveLockfile` seam; run `coverDependencyBump` in the compare)

**Interfaces:**
- Consumes: Task 2's `matchesAllowlist`/`manifestBumpViolations`; `makeGitRepo`/`FIXTURE_TSCONFIG_JSON`/`waiverCommitMessage` from `src/test-helpers.ts`; `validateCommit` from `src/validate-commit.ts`; `FileFinding` from `src/report.ts`.
- Produces: `resolvePnpmLockfile(dir: string): Promise<void>`; `coverDependencyBump(compareSet: readonly string[], ctx: DependencyContext, fileFindings: FileFinding[], failures: string[]): Promise<Set<string>>`; `interface DependencyContext { oDir: string; headDir: string; resolveLockfile: (dir: string) => Promise<void>; }`; `ValidateOptions.resolveLockfile?: (dir: string) => Promise<void>`.

- [ ] **Step 1: Add failing integration tests** — append to `src/engine/deps.test.ts`:

```ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { FIXTURE_TSCONFIG_JSON, type GitRepoFixture, makeGitRepo } from '../test-helpers.js';
import type { Waiver } from '../types.js';
import { validateCommit } from '../validate-commit.js';

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

const BASE_LOCK = 'lockfileVersion: "9.0"\n# base resolution\n';
const HEAD_LOCK = 'lockfileVersion: "9.0"\n# head resolution\n';
const ALLOW_JSON = `${JSON.stringify({ allowBumping: ['lodash', '@myorg/*'] })}\n`;
const EMPTY_WAIVER: Waiver = { schema: 'waiver-stamp/v0', ops: [] };

function pkgJson(overrides: Record<string, unknown> = {}): string {
  const manifest = {
    name: 'fixture',
    packageManager: 'pnpm@9.0.0',
    dependencies: { lodash: '^1.0.0', 'left-pad': '^1.0.0' },
    devDependencies: { '@myorg/a': '1.0.0' },
    ...overrides,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The fake resolver stands in for pnpm: lands O's lockfile on head's bytes. */
async function fakeResolver(dir: string): Promise<void> {
  await writeFile(join(dir, 'pnpm-lock.yaml'), HEAD_LOCK, 'utf8');
}

async function baseCommit(extra: Record<string, string> = {}): Promise<string> {
  if (!g) throw new Error('repo not initialized');
  return g.commit(
    {
      'tsconfig.json': FIXTURE_TSCONFIG_JSON,
      'src/a.ts': 'export const a = 1;\n',
      'package.json': pkgJson(),
      'pnpm-lock.yaml': BASE_LOCK,
      '.waiver-stamp.json': ALLOW_JSON,
      ...extra,
    },
    'base',
  );
}

async function validate(commit: string, resolveLockfile = fakeResolver) {
  if (!g) throw new Error('repo not initialized');
  return validateCommit(EMPTY_WAIVER, { commit, cwd: g.repo, resolveLockfile });
}

describe('dependency-bump policy (validateCommit integration)', () => {
  it('COVERS an allowlisted up-move whose lockfile re-derives exactly', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const report = await validate(head);
    expect(report.failures).toEqual([]);
    expect(report.stamped).toBe(true);
  });

  it('FAILS when the re-derived lockfile differs from head', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n# tampered\n',
      },
      'bump + tampered lock',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('dependency bump not covered');
    expect(report.uncovered).toContain('pnpm-lock.yaml');
  });

  it('FAILS when the bumped package is not on allowBumping', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump left-pad',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('not on allowBumping');
  });

  it('FAILS when there is no .waiver-stamp.json (feature off)', async () => {
    g = await makeGitRepo();
    await g.commit(
      {
        'tsconfig.json': FIXTURE_TSCONFIG_JSON,
        'src/a.ts': 'export const a = 1;\n',
        'package.json': pkgJson(),
        'pnpm-lock.yaml': BASE_LOCK,
      },
      'base without config',
    );
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('allowBumping');
  });

  it('FAILS on a downward move', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '>=0.1.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'downgrade lodash',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('below base floor');
  });

  it('FAILS when a non-dependency manifest field also changed', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({
          dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' },
          scripts: { postinstall: 'curl x | sh' },
        }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump + smuggle',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain("field 'scripts' changed");
  });

  it('FAILS on a non-pnpm repo', async () => {
    g = await makeGitRepo();
    await baseCommit({ 'package.json': pkgJson({ packageManager: 'npm@10.0.0' }) });
    const head = await g.commit(
      {
        'package.json': pkgJson({
          packageManager: 'npm@10.0.0',
          dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' },
        }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump on npm repo',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('pnpm');
  });

  it('FAILS with the resolver error when re-resolution blows up', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
      },
      'bump lodash',
    );
    const boom = async () => {
      throw new Error('registry unreachable');
    };
    const report = await validate(head, boom);
    expect(report.stamped).toBe(false);
    expect(report.failures.join('\n')).toContain('registry unreachable');
  });

  it('FAILS closed when the PR widens .waiver-stamp.json for itself', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^1.0.0', 'left-pad': '^2.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
        '.waiver-stamp.json': `${JSON.stringify({ allowBumping: ['lodash', 'left-pad'] })}\n`,
      },
      'self-widening bump',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    // base allowlist governs (left-pad not on it)…
    expect(report.failures.join('\n')).toContain('not on allowBumping');
    // …and the config edit itself is uncovered.
    expect(report.uncovered).toContain('.waiver-stamp.json');
  });

  it('FAILS when a source file changes alongside the bump', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit(
      {
        'package.json': pkgJson({ dependencies: { lodash: '^2.0.0', 'left-pad': '^1.0.0' } }),
        'pnpm-lock.yaml': HEAD_LOCK,
        'src/a.ts': 'export const a = 2;\n',
      },
      'bump + source edit',
    );
    const report = await validate(head);
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toContain('src/a.ts');
  });

  it('leaves package.json uncovered when it did not change (policy dormant)', async () => {
    g = await makeGitRepo();
    await baseCommit();
    const head = await g.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'source only');
    const report = await validate(head);
    // No package.json change → policy does not fire; the source edit is uncovered.
    expect(report.stamped).toBe(false);
    expect(report.uncovered).toEqual(['src/a.ts']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/engine/deps.test.ts`
Expected: unit tests PASS; integration tests FAIL — `resolveLockfile` isn't on `ValidateOptions` yet and `coverDependencyBump` isn't wired, so package.json/lockfile mismatch as raw bytes (no "dependency bump not covered" reason). `pnpm typecheck` also rejects the `resolveLockfile` option. Expected red.

- [ ] **Step 3: Add the evaluator to `src/engine/deps.ts`** — new imports at the top of the file:

```ts
import { execFile } from 'node:child_process';
import { access, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import type { FileFinding } from '../report.js';
```

And append:

```ts
/** Per-repo config at the repo root, read from BASE — a PR cannot widen it for itself. */
const CONFIG_FILE = '.waiver-stamp.json';
const LOCKFILE = 'pnpm-lock.yaml';
const MANIFEST = 'package.json';

const RepoConfigSchema = z.looseObject({
  allowBumping: z.array(z.string().min(1)).optional(),
});

/** What the standing policy needs from `validateCommit`. */
export interface DependencyContext {
  /** O's worktree (base = the commit's parent); the re-resolve writes here. */
  oDir: string;
  /** The commit's worktree — read for head's manifest + lockfile, never mutated. */
  headDir: string;
  /** Re-derive `oDir`'s lockfile from its manifest (pnpm subprocess; tests inject fakes). */
  resolveLockfile: (dir: string) => Promise<void>;
}

/**
 * If `package.json` is among the changed files, decide whether the manifest+lockfile
 * change is a covered bump (spec §6.3) and record findings. Returns the set of files
 * the policy claimed, so the caller's byte-compare skips them.
 */
export async function coverDependencyBump(
  compareSet: readonly string[],
  ctx: DependencyContext,
  fileFindings: FileFinding[],
  failures: string[],
): Promise<Set<string>> {
  const claimed = new Set<string>();
  if (!compareSet.includes(MANIFEST)) return claimed;
  claimed.add(MANIFEST);
  if (compareSet.includes(LOCKFILE)) claimed.add(LOCKFILE);

  const reason = await evaluate(ctx);
  if (reason === null) {
    for (const f of claimed) fileFindings.push({ file: f, status: 'reproduced' });
  } else {
    for (const f of claimed) fileFindings.push({ file: f, status: 'mismatch', reason });
    failures.push(`dependency bump not covered: ${reason}`);
  }
  return claimed;
}

/** `null` if the manifest+lockfile change is a covered bump; else the reason it is not. */
async function evaluate(ctx: DependencyContext): Promise<string | null> {
  const baseManifest = await readManifest(ctx.oDir);
  if (!baseManifest) return `${MANIFEST} not found or invalid in base`;

  const pm = baseManifest.packageManager;
  if (typeof pm !== 'string' || !pm.startsWith('pnpm@')) {
    return 'base package.json must pin `packageManager` to pnpm (only pnpm is supported)';
  }
  try {
    await access(join(ctx.oDir, LOCKFILE));
  } catch {
    return `${LOCKFILE} not found in base`;
  }

  const allowlist = await loadAllowlist(ctx.oDir);
  if (allowlist === null) return `${CONFIG_FILE} is invalid`;
  if (allowlist.length === 0) return `no allowBumping configured in base ${CONFIG_FILE}`;

  const headManifest = await readManifest(ctx.headDir);
  if (!headManifest) return `${MANIFEST} not found or invalid in head`;

  const violations = manifestBumpViolations(baseManifest, headManifest, allowlist);
  if (violations.length > 0) return violations.join('; ');

  // Adopt head's manifest, then re-derive the lockfile from base's committed config.
  await copyFile(join(ctx.headDir, MANIFEST), join(ctx.oDir, MANIFEST));
  try {
    await ctx.resolveLockfile(ctx.oDir);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const [reResolved, headLock] = await Promise.all([
    readOrEmpty(join(ctx.oDir, LOCKFILE)),
    readOrEmpty(join(ctx.headDir, LOCKFILE)),
  ]);
  if (!reResolved.equals(headLock)) return `${LOCKFILE} does not re-resolve to head`;
  return null;
}

const exec = promisify(execFile);

/** The real resolver: lockfile-only, scripts inert, prefer existing pins to bound drift. */
export async function resolvePnpmLockfile(dir: string): Promise<void> {
  await exec(
    'pnpm',
    ['install', '--lockfile-only', '--ignore-scripts', '--prefer-frozen-lockfile'],
    { cwd: dir },
  );
}

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')));
  } catch {
    return null;
  }
}

/** `null` on malformed config; `[]` on absent/empty (feature off, fail-closed at the call site). */
async function loadAllowlist(baseDir: string): Promise<readonly string[] | null> {
  let raw: string;
  try {
    raw = await readFile(join(baseDir, CONFIG_FILE), 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = RepoConfigSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data.allowBumping ?? [];
}

async function readOrEmpty(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
```

- [ ] **Step 4: Wire into `src/validate-commit.ts`**

Add the import:

```ts
import { coverDependencyBump, resolvePnpmLockfile } from './engine/deps.js';
```

Add the seam to `ValidateOptions`:

```ts
export interface ValidateOptions {
  /** The commit whose diff against its parent is validated. */
  commit: string;
  /** Repo path where `commit` lives. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Lockfile re-resolution for the dependency-bump policy (§6.3, test seam). Defaults
   * to the real pnpm subprocess; tests inject fakes so no network or pnpm binary runs.
   */
  resolveLockfile?: (dir: string) => Promise<void>;
}
```

Replace the compare loop (currently the `for (const file of compareSet) { … }` block) with a standing dependency-bump pass followed by the byte/emit compare over the rest:

```ts
    // Standing dependency-bump policy (§6.3): may cover package.json + lockfile.
    const claimed = await coverDependencyBump(
      compareSet,
      {
        oDir: oWt.dir,
        headDir: headWt.dir,
        resolveLockfile: options.resolveLockfile ?? resolvePnpmLockfile,
      },
      fileFindings,
      failures,
    );

    for (const file of compareSet) {
      if (claimed.has(file)) continue;
      const equal = await filesEquivalent(file, oProject, oWt.dir, headProject, headWt.dir);
      fileFindings.push({ file, status: equal ? 'reproduced' : 'mismatch' });
      if (!equal) failures.push(`uncovered change: ${file}`);
    }
```

(The `uncovered` list is derived from `fileFindings` with `status === 'mismatch'`, so a not-covered bump — pushed as `mismatch` by `coverDependencyBump` — correctly appears in `uncovered`, and the `failures` entry carries the reason.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/engine/deps.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS (whole suite).

- [ ] **Step 6: Commit**

```bash
git add src/engine/deps.ts src/engine/deps.test.ts src/validate-commit.ts
git commit -m "feat: standing dependency-bump policy"
```

---

### Task 4: Docs — README + skill

Spec is already updated. Bring the README scope and the skill's op vocabulary / authoring guidance in line: `bump` is not an op; dependency bumps are a standing policy needing an empty waiver + `.waiver-stamp.json`.

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/refactor-with-waiver/SKILL.md`

**Interfaces:** none (prose only). Keep every claim consistent with Task 3: policy read from base, pnpm-only, empty-waiver-required, `apply` untouched.

- [ ] **Step 1: README — update the Scope (v0) section**

Replace the "Implemented:" paragraph (the one listing `rename`/`move-file`/`change-test`/`change-docs`) so it reads:

```markdown
Implemented: the **`rename`** and **`move-file`** reproductive ops; **`change-test`** /
**`change-docs`** exclusion ops; the standing **dependency-bump policy** (allowlisted,
up-moving dependency bumps confined to `package.json` + `pnpm-lock.yaml`, re-derived by
running pnpm — pnpm repos only, `allowBumping` in a committed `.waiver-stamp.json`, off by
default); and the empty/minimal waiver (formatting-, comment-, and type-only changes are
invisible to the emit comparison, so they need no op). Guards: dynamic-reference,
published-API, emit-divergence (fail-closed). Single Nx project, app-internal.
```

And in the "Planned next" paragraph, replace `bump` with npm/yarn support (bump is no longer a planned op):

```markdown
Planned next (the vocabulary already lists them; authoring them errors today):
`extract-function`, `move-to-new-file`, npm/yarn support for the dependency-bump policy,
and multi-project reproductive coverage. See [`docs/spec.md` §13/§21](docs/spec.md) for
the roadmap.
```

- [ ] **Step 2: SKILL — remove `bump` from the "Not yet implemented" note**

Replace the callout block:

```markdown
> **Not yet implemented in this build:** `extract-function` and `move-to-new-file`.
> The schema still lists them, but `apply` / `stamp` will FAIL with "not yet
> implemented in v0" if a waiver uses them. They are planned next — do **not** author
> waivers using them yet. For v0, stick to `rename` / `move-file`, the
> `change-test` / `change-docs` exclusions, and empty/minimal waivers.
```

- [ ] **Step 3: SKILL — add a dependency-bump subsection after "What needs no op"**

After the "## What needs no op (free under emit comparison, §7)" section, insert:

```markdown
## Dependency bumps need no op (standing policy, §6.3)

Bumping a dependency is **not** a waiver op. If the repo has a `.waiver-stamp.json` with
an `allowBumping` list, an allowlisted, up-moving bump confined to `package.json` +
`pnpm-lock.yaml` is covered automatically — like formatting. To land one:

1. Bump it with your package manager: `pnpm add <pkg>@latest` (or `@5.1.0` to pin).
2. Commit `package.json` + `pnpm-lock.yaml` with an **empty** waiver embedded —
   `{ "schema": "waiver-stamp/v0", "ops": [] }` — which opts the commit into stamping.
3. `waiver verify` — the policy re-resolves the lockfile and checks it matches.

`apply` does **not** expand a bump (there is no op). pnpm repos only. Anything outside
the envelope — a non-allowlisted package, a downward move, a `git:`/`npm:` specifier, any
other manifest field — is not covered → the commit falls to review. Re-resolution runs at
stamp time, so **stamp promptly** and **prefer exact pins**; a registry that moved after
you authored can FAIL the re-stamp (fail-closed). Keep a bump in **its own commit** when
bundling with a `rename`/`move-file`, so a registry hiccup can't un-stamp the refactor.
```

- [ ] **Step 4: Verify green**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (docs don't affect tests; run to confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add README.md plugin/skills/refactor-with-waiver/SKILL.md
git commit -m "docs: dependency-bump policy in readme and skill"
```

---

## Final gate

- [ ] Run: `pnpm test && pnpm typecheck && pnpm lint` — all green.
- [ ] `grep -rn "bump" src` returns nothing (the op is fully gone; the policy is "dependency-bump" only in comments/docs).
- [ ] `git log --oneline` shows the four task commits, none timestamped inside Mon–Fri 09:00–18:00 +0200.

## Self-review notes

- **Spec coverage:** §6.3 config (`allowBumping`, base-read, off-by-default) → Task 3 loader + tests; the 5-part coverage rule → `manifestBumpViolations` (steps 1–4, Task 2) + `evaluate` re-resolve (step 5, Task 3); "empty waiver required" → tests use `EMPTY_WAIVER`, policy runs only in `validateCommit`; "why re-resolve vs CI" → honest-lockfile test (`FAILS when the re-derived lockfile differs`); `--prefer-frozen-lockfile` → `resolvePnpmLockfile`; registry-drift/determinism (§9) → documented, the real resolver is integration-only. §2/§5.1 "no op" → Task 1 removes it.
- **Type consistency:** `DependencyContext` / `coverDependencyBump` / `resolvePnpmLockfile` / `ValidateOptions.resolveLockfile` names match across Tasks 2–3. `manifestBumpViolations(base, head, allowlist)` signature stable.
- **Known real-pnpm gap:** the integration tests use a fake resolver (hermetic). The real `pnpm install … --prefer-frozen-lockfile` behavior (and the drift bound) is exercised only in live stamping — noted in spec §9; a real-pnpm integration test is roadmap, not v0.
