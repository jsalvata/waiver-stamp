/** Public library surface for waiver-stamp. The CLI (`waiver`) is a thin wrapper over these. */

export * from './waiver/types.ts';
export * from './errors.ts';
export * from './commands/report.ts';
export { WaiverSchema, OpSchema, jsonSchema, SCHEMA_VERSION, SCHEMA_ID } from './waiver/schema.ts';
export { loadWaiver, loadWaiverFromObject } from './waiver/load.ts';
export { apply, applyWaiver, type ApplyOptions, type ApplyResult } from './commands/apply.ts';
export { createServer, startMcpServer } from './mcp.ts';
export { validateCommit, type ValidateOptions } from './commands/validate-commit.ts';
export { stamp, aggregate, type StampRangeOptions } from './commands/stamp.ts';
export { verify, classifyCommit, type VerifyOptions } from './commands/verify.ts';
export { extractWaiverBlock, type WaiverBlock } from './waiver/commit-waiver.ts';
