import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export interface PromptIo {
  input: Readable;
  output: Writable;
  isTTY: boolean;
}

const defaultIo = (): PromptIo => ({
  input: process.stdin,
  output: process.stdout,
  isTTY: Boolean(process.stdin.isTTY),
});

/**
 * A single yes/no question, defaulting to **no** — anything but an explicit yes declines. Returns
 * the default without reading when stdin isn't a TTY, so piped/CI runs don't hang on an answer
 * nobody is there to type.
 */
export async function confirmYesNo(question: string, io: PromptIo = defaultIo()): Promise<boolean> {
  if (!io.isTTY) return false;
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
