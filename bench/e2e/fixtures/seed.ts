/**
 * The sandbox base tree every fixture branches from (`run.ts` commits this once, to
 * `e2e-sandbox-base`, before creating fixture branches off it). A tiny real TypeScript file so
 * a `rename` op has something to fold the §3.1 stamping principle over, matching the shape
 * `src/commands/stamp.test.ts` uses for its own in-process fixtures.
 */

export const ORDERS_BASE =
  'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
export const USAGE_BASE =
  "import { calculateTotal } from './orders';\nexport const t = calculateTotal(21);\n";

export const ORDERS_RENAMED =
  'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
export const USAGE_RENAMED =
  "import { computeTotal } from './orders';\nexport const t = computeTotal(21);\n";

/** Files that make the sandbox base a loadable ts-morph project, mirroring `test-helpers.ts`. */
export const SANDBOX_BASE_FILES: Record<string, string> = {
  'e2e-sandbox/tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        declaration: false,
        skipLibCheck: true,
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  )}\n`,
  'e2e-sandbox/src/orders.ts': ORDERS_BASE,
  'e2e-sandbox/src/usage.ts': USAGE_BASE,
};

/** The rename waiver every "stamped" commit embeds — identical op across all fixtures. */
export const RENAME_WAIVER = {
  schema: 'waiver-stamp/v0',
  ops: [
    {
      op: 'rename',
      target: { file: 'e2e-sandbox/src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
};

/** Build a commit message embedding `waiver` as a fenced ```waiver block (spec §17.1). */
export function waiverCommitMessage(subject: string, waiver: unknown): string {
  return `${subject}\n\n\`\`\`waiver\n${JSON.stringify(waiver, null, 2)}\n\`\`\`\n`;
}
