/** File-based stamping CLI seam (§10). Reads a waiver file and stamps a base/head diff. */
import { loadWaiver } from './load.js';
import type { StampReport } from './report.js';
import { stampWaiver, type StampOptions } from './stamp-core.js';

export type { StampOptions } from './stamp-core.js';
export { stampWaiver } from './stamp-core.js';

export async function stamp(path: string, options: StampOptions): Promise<StampReport> {
  return stampWaiver(await loadWaiver(path), options);
}
