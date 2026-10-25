import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { app, processPost, ThreadsPublisher } from '../src/index';
import { seal, unseal, ThreadsApi, ThreadsError } from '../src/threads';
import { signAdminSsoToken } from '../src/admin-sso-token';

const secret = btoa('12345678901234567890123456789012');
let sqlite: InstanceType<typeof Database>;
let env: any;
const schedulerState = (storage: any = { setAlarm: vi.fn(), getAlarm: async () => null, deleteAlarm: vi.fn() }) => {
  const values = new Map();
  return { storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, ...storage }, blockConcurrencyWhile: (fn: () => Promise<unknown>) => fn() };
};
const request = (path: string, method = 'GET', body?: unknown, authorized = true) => app.request(`https://test/api${path}`, { method, headers: { ...(authorized ? { Authorization: 'Bearer workspace-key' } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
const row = (id = 'draft') => sqlite.prepare('SELECT * FROM threads_posts WHERE id=?').get(id) as any;
beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_admin_sso.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_chains_insights.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0004_connection_health.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0005_account_schedulers.sql', import.meta.url), 'utf8'));
  const adapt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...values: unknown[]) => adapt(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
  });
  env = { DB: { prepare: adapt, batch: async (statements: any[]) => sqlite.transaction(() => statements.map(s => ({ meta: { changes: sqlite.prepare(s.sql).run(...s.args).changes } })))() }, API_KEY: 'workspace-key', TOKEN_ENCRYPTION_KEY: secret,
    PUBLISHER: { idFromName: () => 'id', get: () => ({ fetch: async (url: string, init: RequestInit) => new ThreadsPublisher(schedulerState() as any, env).fetch(new Request(url, init)) }) } };
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
    expect(result).not.toContain('token_cipher');
    expect(result).not.toContain('private-token');
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
    const storage = { setAlarm: vi.fn(), getAlarm: async () => null, deleteAlarm: vi.fn() };
    await new ThreadsPublisher(schedulerState(storage) as any, env).alarm();
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
    const accountState = schedulerState();
    await accountState.storage.put('scheduler_key', 'account:123');
    await new ThreadsPublisher(accountState as any, env).alarm();
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

afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });

const allScopes = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'];
function mockConnection(overrides: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/me?')) return Response.json({ id: '123', username: 'owner' });
    if (url.includes('/debug_token?')) return Response.json({ data: { type: 'USER', user_id: '123', is_valid: true, scopes: allScopes, expires_at: Math.floor(Date.now() / 1000) + 3600, ...overrides } });
    throw new Error('unexpected request');
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('account connection and token health', () => {
  it('verifies scopes and actual expiry and reconnects without losing drafts or ownership', async () => {
    const fetcher = mockConnection();
    const response = await request('/accounts', 'POST', { accessToken: '  replacement-token  ' });
    expect(response.status).toBe(201);
    const account = sqlite.prepare('SELECT * FROM threads_accounts WHERE id=?').get('123') as any;
    expect(await unseal(account.token_cipher, secret)).toBe('replacement-token');
    expect(Date.parse(account.token_expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    expect(account.permissions_checked_at).toBeTruthy();
    expect(row().text).toBe('Hello');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('debug_token?input_token=replacement-token');
    const output = await (await request('/accounts')).text();
    expect(output).not.toContain('replacement-token');
    expect(output).not.toContain(account.token_cipher);
  });
  it('rejects missing or declined scopes without overwriting the working token', async () => {
    mockConnection({ scopes: ['threads_basic'] });
    const response = await request('/accounts', 'POST', { accessToken: 'new-token' });
    expect(response.status).toBe(422);
    const output = await response.text();
    expect(output).toContain('threads_content_publish');
    expect(output).toContain('threads_manage_insights');
    const account = sqlite.prepare('SELECT * FROM threads_accounts').get() as any;
    expect(await unseal(account.token_cipher, secret)).toBe('private-token');
  });
  it('returns numeric Meta diagnostics without storing or exposing upstream text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 190, error_subcode: 463, message: 'credential private-token' } }, { status: 400 })));
    const response = await request('/accounts', 'POST', { accessToken: 'private-token' });
    expect(response.status).toBe(422);
    const output = await response.text();
    expect(output).toContain('threads_meta_190_463');
    expect(output).not.toContain('private-token');
    const checked = await request('/accounts/123/check', 'POST');
    expect(checked.status).toBe(422);
    const account = (await (await request('/accounts')).json() as any).data[0];
    expect(account.status).toBe('reauth_required');
    expect(account.last_error_code).toBe('threads_meta_190_463');
  });
  it('validates encryption configuration and input before requesting Meta', async () => {
    const fetcher = mockConnection();
    for (const key of ['', 'not-base64', btoa('x'.repeat(16)), btoa('x'.repeat(24))]) {
      env.TOKEN_ENCRYPTION_KEY = key;
      expect((await request('/accounts', 'POST', { accessToken: 'new-token' })).status).toBe(503);
    }
    env.TOKEN_ENCRYPTION_KEY = secret;
    for (const body of [null, {}, { accessToken: ' ' }, { accessToken: 'x'.repeat(4097) }]) expect((await request('/accounts', 'POST', body)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not claim connected on malformed metadata, expired data access, or mismatched identity', async () => {
    for (const data of [{ is_valid: false }, { type: 'APP' }, { user_id: '456' }, { scopes: null }, { expires_at: 'bad' }, { data_access_expires_at: 1 }]) {
      mockConnection(data);
      expect((await request('/accounts', 'POST', { accessToken: 'new-token' })).status).not.toBe(201);
    }
  });
  it('retains unknown expiry and distinguishes an inspection credential failure from user revocation', async () => {
    mockConnection({ expires_at: 0 });
    expect((await request('/accounts/123/check', 'POST')).status).toBe(200);
    let account = (await (await request('/accounts')).json() as any).data[0];
    expect(account.token_expires_at).toBeNull();
    env.THREADS_APP_ACCESS_TOKEN = 'private-app-token';
    const fetcher = mockConnection();
    fetcher.mockImplementation(async (url: string) => url.includes('/me?') ? Response.json({ id: '123', username: 'owner' }) : Response.json({ error: { code: 190, message: 'private-app-token' } }, { status: 400 }));
    const checked = await request('/accounts/123/check', 'POST');
    expect(checked.status).toBe(502);
    expect(await checked.text()).not.toContain('private-app-token');
    account = (await (await request('/accounts')).json() as any).data[0];
    expect(account.status).toBe('connected');
    expect(account.last_error_code).toBe('token_inspection_failed');
  });
  it('blocks reservations beyond known expiry and stops expired queued work without external posting', async () => {
    const client = { create: vi.fn() };
    const expires = new Date(Date.now() + 3600000).toISOString();
    sqlite.prepare('UPDATE threads_accounts SET token_expires_at=?').run(expires);
    expect((await request('/posts/draft/queue', 'POST', { scheduledAt: new Date(Date.now() + 7200000).toISOString() })).status).toBe(409);
    sqlite.prepare("UPDATE threads_accounts SET token_expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await (await request('/accounts')).json() as any).data[0].status).toBe('expired');
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    await processPost(env, row(), () => client as any);
    expect(client.create).not.toHaveBeenCalled();
    expect(row().error_code).toBe('token_expired');
    expect(row().status).toBe('failed');
  });
  it('preserves Meta codes on publication failure and never retries', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    const client = { create: vi.fn(async () => { throw new ThreadsError('threads_meta_190_463', 'expired', 422, 190, 463); }) };
    await processPost(env, row(), () => client as any);
    await processPost(env, row(), () => client as any);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(row().status).toBe('needs_review');
    expect(row().error_code).toBe('threads_meta_190_463');
    expect((await (await request('/accounts')).json() as any).data[0].status).toBe('reauth_required');
  });
  it('does not let an old in-flight failure invalidate a reconnected token', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    const replacement = await seal('new-token', secret);
    const client = { create: async () => {
      sqlite.prepare("UPDATE threads_accounts SET token_cipher=?, status='connected'").run(replacement);
      throw new ThreadsError('threads_meta_190', 'expired', 422, 190);
    } };
    await processPost(env, row(), () => client as any);
    expect((await (await request('/accounts')).json() as any).data[0].status).toBe('connected');
  });
  it('handles non-JSON upstream failures and numeric rate-limit codes safely', async () => {
    for (const response of [new Response('secret-token', { status: 502 }), Response.json({ error: { code: 4, message: 'secret-token' } }, { status: 429 })]) {
      const client = new ThreadsApi('secret-token', vi.fn(async () => response));
      await expect(client.profile()).rejects.toThrow(/HTTP 502|Meta 4/);
    }
  });
});

describe('scheduler idle shutdown', () => {
  it('stops with no queued jobs and wakes on a new queue request', async () => {
    const state = schedulerState();
    const publisher = new ThreadsPublisher(state as any, env);
    await publisher.alarm();
    expect(state.storage.deleteAlarm).toHaveBeenCalledOnce();
    await publisher.fetch(new Request('https://publisher/queue', { method: 'POST', body: JSON.stringify({ id: 'draft', scheduledAt: new Date().toISOString() }) }));
    expect(row().status).toBe('queued');
    expect(state.storage.setAlarm).toHaveBeenLastCalledWith(expect.any(Number));
  });
  it('sleeps until a future reservation instead of losing it or polling each minute', async () => {
    const due = new Date(Date.now() + 3600000).toISOString();
    sqlite.prepare("UPDATE threads_posts SET status='queued', scheduled_at=?").run(due);
    const state = schedulerState();
    await new ThreadsPublisher(state as any, env).alarm();
    expect(state.storage.deleteAlarm).not.toHaveBeenCalled();
    expect(state.storage.setAlarm).toHaveBeenLastCalledWith(Date.parse(due));
  });
  it('keeps recovery for in-flight work and wakes earlier than an existing future alarm', async () => {
    const state = schedulerState({ setAlarm: vi.fn(), getAlarm: async () => Date.now() + 86400000, deleteAlarm: vi.fn() });
    const publisher = new ThreadsPublisher(state as any, env);
    sqlite.prepare("UPDATE threads_posts SET status='creating', updated_at=?").run(new Date().toISOString());
    await publisher.alarm();
    expect(state.storage.deleteAlarm).not.toHaveBeenCalled();
    await publisher.fetch(new Request('https://publisher/arm', { method: 'POST' }));
    expect(state.storage.setAlarm.mock.calls.at(-1)[0] - Date.now()).toBeLessThanOrEqual(1000);
  });
});

it('authenticated readiness reports only configuration flags and counts', async () => {
  expect((await request('/health', 'GET', undefined, false)).status).toBe(401);
  const response = await request('/health');
  const body = await response.text();
  expect(JSON.parse(body).data.ready).toBe(true);
  expect(body).not.toContain(secret);
});
it('keeps legacy reservations on tenant and isolates new account schedulers', async () => {
  const legacy = new Date(Date.now() + 3600000).toISOString();
  sqlite.prepare("INSERT INTO threads_posts (id,account_id,text,status,scheduled_at,created_at,updated_at) VALUES ('legacy','123','old','queued',?,?,?)").run(legacy, legacy, legacy);
  await request('/posts/draft/queue', 'POST', { scheduledAt: new Date(Date.now() + 7200000).toISOString() });
  expect(row().scheduler_key).toBe('account:123');
  expect(row('legacy').scheduler_key).toBe('tenant');
  const state = schedulerState();
  await new ThreadsPublisher(state as any, env).alarm();
  expect(state.storage.setAlarm).toHaveBeenLastCalledWith(Date.parse(legacy));
});
it('cannot lose a queue request arriving while the idle alarm is shutting down', async () => {
  let alarmAt: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const state = schedulerState({ getAlarm: async () => alarmAt, setAlarm: async (time: number) => { alarmAt = time; }, deleteAlarm: async () => { alarmAt = null; } });
  state.blockConcurrencyWhile = (callback: () => Promise<unknown>) => {
    const result = chain.then(callback); chain = result.catch(() => {}); return result;
  };
  let reached!: () => void, release!: () => void;
  const readingIdle = new Promise<void>(resolve => { reached = resolve; });
  const continueRead = new Promise<void>(resolve => { release = resolve; });
  const original = env.DB.prepare;
  env.DB.prepare = (sql: string) => {
    if (!sql.startsWith('SELECT MIN(')) return original(sql);
    return { bind: (...args: unknown[]) => ({ first: async () => { reached(); await continueRead; return original(sql).bind(...args).first(); } }) };
  };
  const publisher = new ThreadsPublisher(state as any, env);
  const idle = publisher.alarm(); await readingIdle;
  const queued = publisher.fetch(new Request('https://publisher/queue', { method: 'POST', body: JSON.stringify({ id: 'draft', scheduledAt: new Date().toISOString() }) }));
  release(); await Promise.all([idle, queued]);
  expect(row().status).toBe('queued'); expect(alarmAt).not.toBeNull();
});
