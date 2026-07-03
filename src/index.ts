/** Public library surface for waiver-stamp. The CLI (`waiver`) is a thin wrapper over these. */

export * from './types.js';
export * from './errors.js';
export * from './report.js';
export { WaiverSchema, OpSchema, jsonSchema, SCHEMA_VERSION, SCHEMA_ID } from './schema.js';
export { loadWaiver, loadWaiverFromObject } from './load.js';
export { apply, applyWaiver, type ApplyOptions, type ApplyResult } from './apply.js';
export { createServer, startMcpServer } from './mcp.js';
export { validateCommit, type ValidateOptions } from './validate-commit.js';
export { stamp, aggregate, type StampRangeOptions } from './stamp.js';
export { verify, classifyCommit, type VerifyOptions } from './verify.js';
export { extractWaiverBlock, type WaiverBlock } from './commit-waiver.js';
