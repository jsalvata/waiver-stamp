/**
 * Stdio MCP server (spec §18.1) — a thin adapter exposing the engine to a Claude
 * plugin. No second implementation: every tool wraps the same library functions
 * the CLI calls. Waivers are passed inline as JSON (friendlier than file paths
 * for an agent that just authored one). Started by `waiver mcp`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { applyWaiver } from './apply.js';
import { loadWaiverFromObject } from './load.js';
import { InlineWaiverSchema } from './schema.js';
import { stampWaiver } from './stamp.js';
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

/** Build the MCP server. `tool` is the running `waiver-stamp@x.y.z` id (for the pin check). */
export function createServer(tool: string): McpServer {
  const version = tool.split('@')[1] ?? '0.0.0';
  const server = new McpServer({ name: 'waiver-stamp', version });

  server.registerTool(
    'waiver_check',
    {
      description: 'Validate a draft waiver (schema). The agent inner authoring loop (§18.1).',
      inputSchema: { waiver: InlineWaiverSchema, cwd: z.string().optional() },
    },
    async ({ waiver }) => {
      try {
        const w = loadWaiverFromObject(waiver);
        return ok({ ok: true, waiver: { schema: w.schema, tool: w.tool } });
      } catch (err) {
        return fail(err);
      }
    },
  );

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
      description: 'Stamp a waiver against base/head refs (§18.1).',
      inputSchema: {
        waiver: InlineWaiverSchema,
        base: z.string(),
        head: z.string(),
        cwd: z.string().optional(),
      },
    },
    async ({ waiver, base, head, cwd }) => {
      try {
        const report = await stampWaiver(loadWaiverFromObject(waiver), {
          base,
          head,
          cwd: cwd ?? process.cwd(),
          tool,
        });
        return ok(report);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'waiver_verify',
    {
      description:
        'Per-commit verdict over a range: APPROVE/COMMENT/REQUEST_CHANGES/ABSTAIN (§17.2).',
      inputSchema: { base: z.string(), head: z.string(), cwd: z.string().optional() },
    },
    async ({ base, head, cwd }) => {
      try {
        return ok(await verify({ base, head, cwd: cwd ?? process.cwd(), tool }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

/** Start the MCP server on stdio (the `waiver mcp` subcommand). */
export async function startMcpServer(tool: string): Promise<void> {
  const server = createServer(tool);
  await server.connect(new StdioServerTransport());
}
