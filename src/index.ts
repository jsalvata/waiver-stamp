/** Public library surface for waiver-stamp. The CLI (`waiver`) is a thin wrapper over these. */

export * from './types.js';
export * from './errors.js';
export * from './report.js';
export { loadWaiver } from './load.js';
export { check, type CheckResult } from './check.js';
export { apply, type ApplyOptions } from './apply.js';
export { stamp, type StampOptions } from './stamp.js';
