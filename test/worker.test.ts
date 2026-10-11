import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { app, processPost, ThreadsPublisher } from '../src/index';
import { seal, unseal, ThreadsApi } from '../src/threads';
import { signAdminSsoToken } from '../src/admin-sso-token';

const secret = btoa('12345678901234567890123456789012');
let sqlite: InstanceType<typeof Database>;
let env: any;
const request = (path: string, method = 'GET', body?: unknown, authorized = true) => app.request(`https://test/api${path}`, { method, headers: { ...(authorized ? { Authorization: 'Bearer workspace-key' } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
const row = (id = 'draft') => sqlite.prepare('SELECT * FROM threads_posts WHERE id=?').get(id) as any;
beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_admin_sso.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_chains_insights.sql', import.meta.url), 'utf8'));
  const adapt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...values: unknown[]) => adapt(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
  });
  env = { DB: { prepare: adapt, batch: async (statements: any[]) => sqlite.transaction(() => statements.map(s => ({ meta: { changes: sqlite.prepare(s.sql).run(...s.args).changes } })))() }, API_KEY: 'workspace-key', TOKEN_ENCRYPTION_KEY: secret,
    PUBLISHER: { idFromName: () => 'id', get: () => ({ fetch: async () => new Response('ok') }) } };
  sqlite.prepare('INSERT INTO threads_accounts (id,username,token_cipher,created_at,updated_at) VALUES (?,?,?,?,?)').run('123', 'owner', await seal('private-token', secret), '2026-10-11', '2026-10-11');
  sqlite.prepare('INSERT INTO threads_posts (id,account_id,text,created_at,updated_at) VALUES (?,?,?,?,?)').run('draft', '123', 'Hello', '2026-10-11', '2026-10-11');
});
describe('Cloud single-use SSO', () => {
  it('does not consume on HEAD, rejects replay, and escapes the API key', async () => {
    env.ADMIN_SSO_SECRET = 's'.repeat(40);
    env.API_KEY = '</script><script>alert(1)</script>';
    const epoch = Math.floor(Date.now() / 1000);
    const token = await signAdminSsoToken(env.ADMIN_SSO_SECRET, { aud: 'admin-sso', iat: epoch, exp: epoch + 60, jti: 'unique-token-123' });
    const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const url = `https://test/admin/sso?token=${token}`;
    expect((await app.request(url, { method: 'HEAD' }, env, context)).status).toBe(200);
    const response = await app.request(url, {}, env, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const html = await response.text();
    expect(html).toContain('threads_api_key');
    expect(html).not.toContain(env.API_KEY);
    expect((await app.request(url, {}, env, context)).status).toBe(403);
  });
  it('rejects expired and cross-tenant tokens', async () => {
    env.ADMIN_SSO_SECRET = 's'.repeat(40);
    const epoch = Math.floor(Date.now() / 1000);
    for (const [key, exp] of [[env.ADMIN_SSO_SECRET, epoch - 1], ['different'.repeat(8), epoch + 60]] as const) {
      const token = await signAdminSsoToken(key, { aud: 'admin-sso', iat: epoch - 30, exp, jti: 'unique-token-123' });
      expect((await app.request(`https://test/admin/sso?token=${token}`, {}, env)).status).toBe(403);
    }
  });
});
describe('authenticated tenant drafts', () => {
  it('requires workspace authentication and never returns encrypted credentials', async () => {
    expect((await request('/accounts', 'GET', undefined, false)).status).toBe(401);
    const result = await (await request('/accounts')).text();
    expect(result).toContain('owner');
    expect(result).not.toContain('token');
  });
  it('filters by account and rejects unknown accounts or excessive text', async () => {
    expect((await request('/posts', 'POST', { accountId: 'other', text: 'hello' })).status).toBe(400);
    expect((await request('/posts', 'POST', { accountId: '123', text: 'a'.repeat(501) })).status).toBe(400);
    expect((await (await request('/posts?accountId=other')).json() as any).data).toEqual([]);
    expect((await (await request('/posts?accountId=123')).json() as any).data).toHaveLength(1);
  });
  it('queues only once and stops editing once queued', async () => {
    expect((await request('/posts/draft/queue', 'POST', {})).status).toBe(200);
    expect((await request('/posts/draft/queue', 'POST', {})).status).toBe(409);
    expect((await request('/posts/draft', 'PATCH', { text: 'changed' })).status).toBe(409);
    expect((await request('/posts/draft/cancel', 'POST', {})).status).toBe(200);
    expect(row().text).toBe('Hello');
  });
  it('archives without deleting history, disconnects without deleting ownership', async () => {
    await request('/posts/draft/archive', 'POST', {});
    expect(row().status).toBe('archived');
    await request('/accounts/123/disconnect', 'POST', {});
    const account = sqlite.prepare('SELECT * FROM threads_accounts').get() as any;
    expect(account.id).toBe('123');
    expect(account.token_cipher).toBeNull();
  });
});
describe('publication idempotency', () => {
  it('claims each stage atomically and keeps the container id', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    const client = { create: vi.fn(async () => 'container'), status: vi.fn(async () => 'FINISHED'), publish: vi.fn(async () => 'published') };
    const same = row();
    await Promise.all([processPost(env, same, () => client as any), processPost(env, same, () => client as any)]);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(row().container_id).toBe('container');
    const processing = row();
    await Promise.all([processPost(env, processing, () => client as any), processPost(env, processing, () => client as any)]);
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(row().published_id).toBe('published');
  });
  it('quarantines an ambiguous publication and never retries it on alarm', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing', container_id='container'").run();
    const client = { status: async () => 'FINISHED', publish: vi.fn(async () => { throw new Error('connection lost'); }) };
    await processPost(env, row(), () => client as any);
    expect(row().status).toBe('needs_review');
    const storage = { setAlarm: vi.fn(), getAlarm: async () => null };
    await new ThreadsPublisher({ storage } as any, env).alarm();
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(row().status).toBe('needs_review');
  });
  it('waits for container readiness without publishing early', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing', container_id='container'").run();
    const client = { status: async () => 'IN_PROGRESS', publish: vi.fn() };
    await processPost(env, row(), () => client as any);
    expect(row().status).toBe('processing');
    expect(client.publish).not.toHaveBeenCalled();
  });
  it('encrypts token values and uses a fixed upstream with auth in headers', async () => {
    const encrypted = await seal('secret-token', secret);
    expect(encrypted).not.toContain('secret-token');
    expect(await unseal(encrypted, secret)).toBe('secret-token');
    const fetcher = vi.fn(async () => Response.json({ id: '123', username: 'owner' }));
    await new ThreadsApi('secret-token', fetcher as any).profile();
    expect(fetcher.mock.calls[0][0]).toBe('https://graph.threads.net/v1.0/me?fields=id,username');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
  });
});

describe('VPS chain workflow', () => {
  it('creates and queues the complete chain atomically, blocks individual child controls', async () => {
    const res = await request('/chains', 'POST', { accountId: '123', parts: ['hook', 'body', 'conclusion'] });
    expect(res.status).toBe(201);
    const { ids } = (await res.json() as any).data;
    expect((await request(`/posts/${ids[1]}/queue`, 'POST', {})).status).toBe(409);
    expect((await request(`/posts/${ids[0]}/queue`, 'POST', {})).status).toBe(200);
    expect(ids.map((id: string) => row(id).status)).toEqual(['queued', 'queued', 'queued']);
    expect((await request(`/posts/${ids[0]}/queue`, 'POST', {})).status).toBe(409);
    expect((await request(`/posts/${ids[0]}/cancel`, 'POST', {})).status).toBe(200);
    expect(ids.map((id: string) => row(id).status)).toEqual(['draft', 'draft', 'draft']);
  });
  it('waits for the parent, replies to its published id, and stops after ambiguous failure', async () => {
    const { ids } = (await (await request('/chains', 'POST', { accountId: '123', parts: ['hook', 'body', 'end'] })).json() as any).data;
    await request(`/posts/${ids[0]}/queue`, 'POST', {});
    const client = { create: vi.fn(async () => 'container'), status: async () => 'FINISHED', publish: vi.fn(async () => 'parent-published') };
    await processPost(env, row(ids[1]), () => client as any);
    expect(client.create).not.toHaveBeenCalled();
    await processPost(env, row(ids[0]), () => client as any);
    await processPost(env, row(ids[0]), () => client as any);
    expect((await request(`/posts/${ids[0]}/cancel`, 'POST', {})).status).toBe(409);
    await processPost(env, row(ids[1]), () => client as any);
    expect(client.create).toHaveBeenLastCalledWith('123', 'body', 'parent-published');
    client.publish.mockRejectedValueOnce(new Error('timeout'));
    await processPost(env, row(ids[1]), () => client as any);
    await new ThreadsPublisher({ storage: { setAlarm: vi.fn() } } as any, env).alarm();
    expect(row(ids[0]).status).toBe('published');
    expect(row(ids[1]).status).toBe('needs_review');
    expect(row(ids[2]).status).toBe('needs_review');
    expect(client.publish).toHaveBeenCalledTimes(2);
  });
  it('keeps missing insights unknown and passes reply id through official API', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ name: 'likes', values: [{ value: 7 }] }, { name: 'views', values: [{ value: 'unknown' }] }] }));
    const api = new ThreadsApi('token', fetcher as any);
    expect(await api.insights('123')).toEqual({ views: null, likes: 7, replies: null, reposts: null, quotes: null });
    fetcher.mockResolvedValueOnce(Response.json({ id: 'container' }));
    await api.create('123', 'body', 'parent');
    expect(String(fetcher.mock.calls[1][1].body)).toContain('reply_to_id=parent');
  });
});
