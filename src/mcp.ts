/**
 * Stdio MCP server (spec §18.1) — a thin adapter exposing the engine to a Claude
 * plugin. No second implementation: every tool wraps the same library functions
 * the CLI calls. Only `apply` takes an inline waiver (friendlier than a file path
 * for an agent that just authored one) — `verify`/`stamp` read the waiver already
 * embedded in the commits they inspect. Started by `waiver mcp`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { applyWaiver } from './apply.js';
import { loadWaiverFromObject } from './load.js';
import { InlineWaiverSchema } from './schema.js';
import { stamp } from './stamp.js';
import { verify } from './verify.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (err: unknown): ToolResult => ({
  content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

/** Build the MCP server. `version` is the running `waiver-stamp` package version. */
export function createServer(version: string): McpServer {
  const server = new McpServer({ name: 'waiver-stamp', version });

  server.registerTool(
    'waiver_apply',
    {
      description: 'Deterministically expand a waiver into a working-tree diff (§18.1).',
      inputSchema: { waiver: InlineWaiverSchema, cwd: z.string().optional() },
    },
    async ({ waiver, cwd }) => {
      try {
        return ok(await applyWaiver(loadWaiverFromObject(waiver), { cwd: cwd ?? process.cwd() }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'waiver_stamp',
    {
      description: 'Aggregate the per-commit PR verdict over base..head (§17.2).',
      inputSchema: { base: z.string(), head: z.string(), cwd: z.string().optional() },
    },
    async ({ base, head, cwd }) => {
      try {
        return ok(await stamp({ base, head, cwd: cwd ?? process.cwd() }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'waiver_verify',
    {
      description: 'Verify one commit against its embedded waiver (§17.4).',
      inputSchema: { commit: z.string().optional(), cwd: z.string().optional() },
    },
    async ({ commit, cwd }) => {
      try {
        return ok(await verify({ commit, cwd: cwd ?? process.cwd() }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

/** Start the MCP server on stdio (the `waiver mcp` subcommand). */
export async function startMcpServer(version: string): Promise<void> {
  const server = createServer(version);
  await server.connect(new StdioServerTransport());
}
