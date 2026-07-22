import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { confirmYesNo } from './prompt.ts';

/** A readable that yields `answer` as soon as something listens, plus the prompt sink. */
function io(answer: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on('data', (c: Buffer) => written.push(c.toString()));
  queueMicrotask(() => input.write(`${answer}\n`));
  return { input, output, written };
}

describe('confirmYesNo', () => {
  it.each([
    ['y', true],
    ['Y', true],
    ['yes', true],
    ['n', false],
    ['no', false],
    ['', false],
    ['garbage', false],
  ] as const)('reads %j as %s', async (answer, expected) => {
    const { input, output } = io(answer);
    expect(await confirmYesNo('Save?', { input, output, isTTY: true })).toBe(expected);
  });

  it('shows the default in the prompt', async () => {
    const { input, output, written } = io('');
    await confirmYesNo('Save?', { input, output, isTTY: true });
    expect(written.join('')).toContain('Save? [y/N]');
  });

  // Non-interactive runs (CI, piped stdin) must not block waiting on an answer nobody can give.
  it('takes the safe default without reading when stdin is not a TTY', async () => {
    const { input, output, written } = io('y');
    expect(await confirmYesNo('Save?', { input, output, isTTY: false })).toBe(false);
    expect(written.join('')).toBe('');
  });
});
