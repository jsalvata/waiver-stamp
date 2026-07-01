import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './mcp.js';

async function connectClient(): Promise<Client> {
  const server = createServer('0.1.0');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

const VALID = {
  schema: 'waiver-stamp/v0',
  ops: [{ op: 'rename', target: { file: 'a.ts', symbol: 'x' }, to: 'y' }],
};

describe('mcp server', () => {
  it('exposes the four waiver tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'waiver_apply',
      'waiver_check',
      'waiver_stamp',
      'waiver_verify',
    ]);
  });

  it('waiver_check accepts a valid inline waiver', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'waiver_check', arguments: { waiver: VALID } });
    expect(res.isError).toBeFalsy();
  });

  it('waiver_check accepts a waiver passed as a JSON string', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'waiver_check',
      arguments: { waiver: JSON.stringify(VALID) },
    });
    expect(res.isError).toBeFalsy();
  });

  it('waiver_check rejects an invalid inline waiver', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'waiver_check',
      arguments: { waiver: { schema: 'waiver-stamp/v0', ops: [{ op: 'nope' }] } },
    });
    expect(res.isError).toBe(true);
  });
});
