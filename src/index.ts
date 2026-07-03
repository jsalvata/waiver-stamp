/** Public library surface for waiver-stamp. The CLI (`waiver`) is a thin wrapper over these. */

export * from './types.ts';
export * from './errors.ts';
export * from './report.ts';
export { WaiverSchema, OpSchema, jsonSchema, SCHEMA_VERSION, SCHEMA_ID } from './schema.ts';
export { loadWaiver, loadWaiverFromObject } from './load.ts';
export { apply, applyWaiver, type ApplyOptions, type ApplyResult } from './apply.ts';
export { createServer, startMcpServer } from './mcp.ts';
export { validateCommit, type ValidateOptions } from './validate-commit.ts';
export { stamp, aggregate, type StampRangeOptions } from './stamp.ts';
export { verify, classifyCommit, type VerifyOptions } from './verify.ts';
export { extractWaiverBlock, type WaiverBlock } from './commit-waiver.ts';
