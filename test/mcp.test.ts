import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// @ts-expect-error Node-only ESM entrypoint.
import { createServer, createApi, readConfig } from '../mcp/server.mjs';
const config = { origin: 'https://workspace.example', key: 'test-secret', readOnly: false };
describe('Threads stdio MCP', () => {
  it('rejects unsafe/missing configuration early without echoing credentials', () => {
    for (const url of ['https://user:secret@example.com', 'https://example.com/?token=secret', 'http://remote.example']) expect(() => readConfig({ THREADS_HARNESS_API_URL: url, THREADS_HARNESS_API_KEY: 'key' })).toThrow();
    expect(() => readConfig({ THREADS_HARNESS_API_URL: 'https://example.com' })).toThrow('THREADS_HARNESS_API_KEY');
  });
  it('advertises only read tools in read-only mode, and rejects direct writes', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: [] }));
    const { server, verify } = createServer({ ...config, readOnly: true }, fetcher);
    await verify();
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['threads_accounts', 'threads_health', 'threads_insights', 'threads_posts']);
    await expect(createApi({ ...config, readOnly: true }, fetcher)('/posts', 'POST', {})).rejects.toThrow('Read-only');
    await client.close(); await server.close();
  });
  it('saves drafts without publishing and requires explicit confirmation for queue', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { id: 'draft' } }));
    const { server } = createServer(config, fetcher);
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    await client.callTool({ name: 'threads_create_draft', arguments: { accountId: '123', text: 'Draft only' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://workspace.example/api/posts');
    const bad = await client.callTool({ name: 'threads_queue', arguments: { postId: 'draft' } });
    expect(bad.isError).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.close(); await server.close();
  });
  it('does not retry ambiguous mutations or echo upstream messages', async () => {
    const fetcher = vi.fn(async () => { throw new Error('secret-url'); });
    await expect(createApi(config, fetcher)('/posts', 'POST', {})).rejects.toThrow('Check saved state');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
