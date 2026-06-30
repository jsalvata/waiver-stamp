import { NotImplementedError } from './errors.js';
import { loadWaiver } from './load.js';

export interface ApplyOptions {
  /** Working tree to apply the waiver's transform ops to. */
  cwd: string;
}

/**
 * Runner (§4): apply a waiver's transform ops to the working tree, deterministically.
 *
 * Scaffold status: the waiver is loaded and schema-validated (real), but the
 * ts-morph fold (rename / extract-function / move-to-new-file / bump) is not yet
 * implemented — this throws {@link NotImplementedError}.
 */
export async function apply(path: string, _options: ApplyOptions): Promise<never> {
  await loadWaiver(path);
  throw new NotImplementedError('apply');
}
