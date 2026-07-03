import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from './mcp.ts';
import {
  FIXTURE_TSCONFIG_JSON,
  type GitRepoFixture,
  makeGitRepo,
  waiverCommitMessage,
} from './test-helpers.ts';
import type { Waiver } from './types.ts';

async function connectClient(): Promise<Client> {
  const server = createServer('0.1.0');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

const ORDERS_BASE = 'export function calculateTotal(n: number): number {\n  return n * 2;\n}\n';
const ORDERS_RENAMED = 'export function computeTotal(n: number): number {\n  return n * 2;\n}\n';
const renameWaiver = (): Waiver => ({
  schema: 'waiver-stamp/v0',
  ops: [
    {
      op: 'rename',
      target: { file: 'src/orders.ts', symbol: 'calculateTotal' },
      to: 'computeTotal',
    },
  ],
});

function parseResult(res: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = res.content as { type: string; text: string }[];
  const first = content[0];
  if (!first) throw new Error('tool result has no content');
  return JSON.parse(first.text);
}

let g: GitRepoFixture | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

describe('mcp server', () => {
  it('exposes the three waiver tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'waiver_apply',
      'waiver_stamp',
      'waiver_verify',
    ]);
  });

  it('waiver_apply rejects an invalid inline waiver', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'waiver_apply',
      arguments: { waiver: { schema: 'waiver-stamp/v0', ops: [{ op: 'nope' }] } },
    });
    expect(res.isError).toBe(true);
  });

  it('waiver_verify on an unresolvable commit surfaces the structured `ref` field', async () => {
    const client = await connectClient();
    g = await makeGitRepo();
    await g.commit({ 'tsconfig.json': FIXTURE_TSCONFIG_JSON }, 'base');
    const res = await client.callTool({
      name: 'waiver_verify',
      arguments: { commit: 'not-a-real-ref', cwd: g.repo },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    expect(text).toContain('not-a-real-ref');
  });

  it('waiver_verify stamps HEAD when the embedded waiver covers the diff', async () => {
    const client = await connectClient();
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED },
      waiverCommitMessage('refactor: rename', renameWaiver()),
    );
    const res = await client.callTool({ name: 'waiver_verify', arguments: { cwd: g.repo } });
    expect(res.isError).toBeFalsy();
    expect(parseResult(res)).toMatchObject({ class: 'stamped' });
  });

  it('waiver_verify reports unwaivered when HEAD carries no waiver', async () => {
    const client = await connectClient();
    g = await makeGitRepo();
    await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    await g.commit({ 'src/orders.ts': `${ORDERS_BASE}// note\n` }, 'chore: touch');
    const res = await client.callTool({ name: 'waiver_verify', arguments: { cwd: g.repo } });
    expect(res.isError).toBeFalsy();
    expect(parseResult(res)).toMatchObject({ class: 'unwaivered' });
  });

  it('waiver_stamp APPROVES when every commit in the range carries a valid waiver', async () => {
    const client = await connectClient();
    g = await makeGitRepo();
    const base = await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    const head = await g.commit(
      { 'src/orders.ts': ORDERS_RENAMED },
      waiverCommitMessage('refactor: rename', renameWaiver()),
    );
    const res = await client.callTool({
      name: 'waiver_stamp',
      arguments: { base, head, cwd: g.repo },
    });
    expect(res.isError).toBeFalsy();
    expect(parseResult(res)).toMatchObject({ verdict: 'APPROVE' });
  });

  it('waiver_stamp ABSTAINS when no commit in the range carries a waiver', async () => {
    const client = await connectClient();
    g = await makeGitRepo();
    const base = await g.commit(
      { 'tsconfig.json': FIXTURE_TSCONFIG_JSON, 'src/orders.ts': ORDERS_BASE },
      'base',
    );
    const head = await g.commit({ 'src/orders.ts': `${ORDERS_BASE}// note\n` }, 'chore: touch');
    const res = await client.callTool({
      name: 'waiver_stamp',
      arguments: { base, head, cwd: g.repo },
    });
    expect(res.isError).toBeFalsy();
    expect(parseResult(res)).toMatchObject({ verdict: 'ABSTAIN' });
  });
});
