import { describe, expect, it } from 'vitest';
import { parseList } from './inputs.ts';

describe('parseList', () => {
  it('splits on commas and newlines, trims, drops empties', () => {
    expect(parseList(' CI, lint \n build \n')).toEqual(['CI', 'lint', 'build']);
  });
  it('empty string → empty list', () => {
    expect(parseList('')).toEqual([]);
  });
});
