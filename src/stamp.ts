import { NotImplementedError } from './errors.js';
import { loadWaiver } from './load.js';
import type { StampReport } from './report.js';

export interface StampOptions {
  /** Base git ref to fold the transform ops over. */
  base: string;
  /** Head git ref whose diff is being stamped. */
  head: string;
}

/**
 * Stamper (§4): validate a PR diff against its waiver via the §3.1 stamping
 * principle (fold + emit-compare + guards) and produce a {@link StampReport}.
 *
 * Scaffold status: the waiver is loaded and schema-validated (real), but the
 * fold + emit-compare engine is not yet implemented — this throws
 * {@link NotImplementedError}.
 */
export async function stamp(path: string, _options: StampOptions): Promise<StampReport> {
  await loadWaiver(path);
  throw new NotImplementedError('stamp');
}
