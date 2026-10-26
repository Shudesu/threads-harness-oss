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
  sqlite.exec(readFileSync(new URL('../migrations/0006_publication_safety.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0007_media.sql', import.meta.url), 'utf8'));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/threads_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250, quota_duration: 86400 }, reply_quota_usage: 0, reply_config: { quota_total: 1000, quota_duration: 86400 } }] });
    throw new Error('Unexpected external request in test');
  }));
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
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), create: vi.fn(async () => 'container'), status: vi.fn(async () => ({ status: 'FINISHED', error_message: null })), publish: vi.fn(async () => 'published') };
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
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), status: async () => ({ status: 'FINISHED', error_message: null }), publish: vi.fn(async () => { throw new Error('connection lost'); }) };
    await processPost(env, row(), () => client as any);
    expect(row().status).toBe('needs_review');
    const storage = { setAlarm: vi.fn(), getAlarm: async () => null, deleteAlarm: vi.fn() };
    await new ThreadsPublisher(schedulerState(storage) as any, env).alarm();
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(row().status).toBe('needs_review');
  });
  it('waits for container readiness without publishing early', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing', container_id='container'").run();
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), status: async () => ({ status: 'IN_PROGRESS', error_message: null }), publish: vi.fn() };
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
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), create: vi.fn(async () => 'container'), status: async () => ({ status: 'FINISHED', error_message: null }), publish: vi.fn(async () => 'parent-published') };
    await processPost(env, row(ids[1]), () => client as any);
    expect(client.create).not.toHaveBeenCalled();
    await processPost(env, row(ids[0]), () => client as any);
    await processPost(env, row(ids[0]), () => client as any);
    expect((await request(`/posts/${ids[0]}/cancel`, 'POST', {})).status).toBe(409);
    await processPost(env, row(ids[1]), () => client as any);
    expect(client.create).toHaveBeenLastCalledWith('123', 'body', 'parent-published', undefined);
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
    expect(await api.insights('123')).toEqual({ views: null, likes: 7, replies: null, reposts: null, quotes: null, shares: null });
    fetcher.mockResolvedValueOnce(Response.json({ id: '456' }));
    await api.create('123', 'body', 'parent');
    expect(String(fetcher.mock.calls[1][1].body)).toContain('reply_to_id=parent');
  });
});

afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });

const allScopes = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'];
function mockConnection(overrides: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/threads_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250, quota_duration: 86400 } }] });
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
    expect(fetcher).toHaveBeenCalledTimes(3);
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
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), create: vi.fn() };
    const expires = new Date(Date.now() + 3600000).toISOString();
    sqlite.prepare('UPDATE threads_accounts SET token_expires_at=?').run(expires);
    expect((await request('/posts/draft/queue', 'POST', { scheduledAt: new Date(Date.now() + 7200000).toISOString() })).status).toBe(409);
    sqlite.prepare("UPDATE threads_accounts SET token_expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await (await request('/accounts')).json() as any).data[0].status).toBe('expired');
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    await processPost(env, row(), () => client as any);
    expect(client.create).not.toHaveBeenCalled();
    expect(row().status).toBe('queued');
    expect((await (await request('/accounts')).json() as any).data[0].last_error_code).toBe('token_expired');
  });
  it('preserves Meta codes on publication failure and never retries', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), create: vi.fn(async () => { throw new ThreadsError('threads_meta_190_463', 'expired', 422, 190, 463); }) };
    await processPost(env, row(), () => client as any);
    await processPost(env, row(), () => client as any);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(row().status).toBe('queued');
    expect(row().error_code).toBe('threads_meta_190_463');
    expect((await (await request('/accounts')).json() as any).data[0].status).toBe('reauth_required');
  });
  it('does not let an old in-flight failure invalidate a reconnected token', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued'").run();
    const replacement = await seal('new-token', secret);
    const client = { publishingLimits: async () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } }), create: async () => {
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

const generousLimits = () => ({ posts: { remaining: 250 }, replies: { remaining: 1000 } });
function quotaResponse(postsUsed = 0, repliesUsed = 0) {
  return Response.json({ data: [{ quota_usage: postsUsed, config: { quota_total: 250, quota_duration: 86400 }, reply_quota_usage: repliesUsed, reply_config: { quota_total: 1000, quota_duration: 86400 } }] });
}
describe('retained reservations after token failure', () => {
  it('pauses after the first rejected create, keeps every due job queued and sleeps', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='queued',scheduled_at='2000-01-01T00:00:00Z'").run();
    for (let i = 0; i < 6; i++) sqlite.prepare("INSERT INTO threads_posts(id,account_id,text,status,scheduled_at,created_at,updated_at) VALUES (?,'123','held','queued','2000-01-01T00:00:00Z','2000','2000')").run(`held-${i}`);
    let creates = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/threads_publishing_limit')) return quotaResponse();
      creates++; return Response.json({ error: { code: 190, error_subcode: 463, message: 'never expose this token' } }, { status: 400 });
    });
    vi.stubGlobal('fetch', fetcher);
    const state = schedulerState(); const publisher = new ThreadsPublisher(state as any, env);
    await publisher.alarm(); await publisher.alarm();
    expect(creates).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM threads_posts WHERE status='queued'").get()).toMatchObject({ n: 7 });
    expect(sqlite.prepare('SELECT status,queue_paused,last_error_kind FROM threads_accounts').get()).toMatchObject({ status: 'reauth_required', queue_paused: 1, last_error_kind: 'token_invalid' });
    expect(state.storage.deleteAlarm).toHaveBeenCalled();
    mockConnection();
    expect((await request('/accounts', 'POST', { accessToken: 'new-token' })).status).toBe(201);
    expect(sqlite.prepare('SELECT queue_paused FROM threads_accounts').get()).toMatchObject({ queue_paused: 1 });
    expect((await request('/accounts/123/resume', 'POST', {})).status).toBe(400);
    expect((await request('/accounts/123/resume', 'POST', { confirmed: true })).status).toBe(200);
    expect(sqlite.prepare('SELECT queue_paused FROM threads_accounts').get()).toMatchObject({ queue_paused: 0 });
    expect((await (await request('/accounts')).json() as any).data[0].pending_count).toBe(7);
    expect(creates).toBe(1);
  });
  it('retains a processing container after an invalid token on the read-only status check', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing',container_id='container'").run();
    const publish = vi.fn();
    const client = { publishingLimits: async () => generousLimits(), status: async () => { throw new ThreadsError('threads_meta_190', 'invalid', 422, 190); }, publish };
    await processPost(env, row(), () => client as any);
    expect(row()).toMatchObject({ status: 'processing', container_id: 'container', error_kind: 'token_invalid' });
    expect(publish).not.toHaveBeenCalled();
  });
});
describe('publishing quotas', () => {
  it('rejects immediate queueing when exhausted without changing the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => quotaResponse(250)));
    const response = await request('/posts/draft/queue', 'POST', {});
    expect(response.status).toBe(409);
    expect((await response.json() as any).kind).toBe('rate_limited');
    expect(row().status).toBe('draft');
  });
  it('checks reply capacity for the complete chain before mutating any part', async () => {
    const { ids } = (await (await request('/chains', 'POST', { accountId: '123', parts: ['root', 'reply'] })).json() as any).data;
    const fetcher = vi.fn(async () => quotaResponse(0, 1000)); vi.stubGlobal('fetch', fetcher);
    expect((await request(`/posts/${ids[0]}/queue`, 'POST', {})).status).toBe(409);
    expect(ids.map((id: string) => row(id).status)).toEqual(['draft', 'draft']);
    expect(fetcher.mock.calls[0][0]).toContain('reply_quota_usage');
  });
  it('does not promise future capacity, and waits before any mutation when execution quota is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => quotaResponse(250)));
    const response = await request('/posts/draft/queue', 'POST', { scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.warning).toContain('保証されません');
    const create = vi.fn();
    await processPost(env, row(), () => ({ publishingLimits: async () => ({ posts: { remaining: 0 } }), create }) as any);
    expect(row()).toMatchObject({ status: 'queued', error_code: 'quota_exhausted' });
    expect(Date.parse(row().next_attempt_at)).toBeGreaterThan(Date.now());
    expect(create).not.toHaveBeenCalled();
  });
  it('serializes competing bookings so they cannot both reserve the last local slot', async () => {
    sqlite.prepare("INSERT INTO threads_posts(id,account_id,text,created_at,updated_at) VALUES ('second','123','second','2000','2000')").run();
    vi.stubGlobal('fetch', vi.fn(async () => quotaResponse(249)));
    const state = schedulerState(); let queue: Promise<unknown> = Promise.resolve();
    state.blockConcurrencyWhile = (fn: () => Promise<unknown>) => { const current = queue.then(fn); queue = current.catch(() => {}); return current; };
    const publisher = new ThreadsPublisher(state as any, env);
    const responses = await Promise.all(['draft', 'second'].map(id => publisher.fetch(new Request('https://publisher/queue', { method: 'POST', body: JSON.stringify({ id, scheduledAt: new Date().toISOString() }) }))));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM threads_posts WHERE status='queued'").get()).toMatchObject({ n: 1 });
  });
});
describe('container outcomes and bounded read polling', () => {
  it.each([['ERROR', 'container_error_failed_processing_video', 'failed'], ['EXPIRED', 'container_expired', 'failed'], ['PUBLISHED', 'container_already_published', 'needs_review']])('classifies %s without publishing', async (status, code, outcome) => {
    sqlite.prepare("UPDATE threads_posts SET status='processing',container_id='container'").run();
    const publish = vi.fn();
    await processPost(env, row(), () => ({ publishingLimits: async () => generousLimits(), status: async () => ({ status, error_message: status === 'ERROR' ? 'FAILED_PROCESSING_VIDEO' : null }), publish }) as any);
    expect(row()).toMatchObject({ status: outcome, error_code: code, error_kind: 'container_error' });
    expect(publish).not.toHaveBeenCalled();
  });
  it('polls a status 404 at most five times, preserving the same container and never recreating it', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing',container_id='container'").run();
    const status = vi.fn(async () => { throw new ThreadsError('threads_http_404', 'not visible', 502, undefined, undefined, 404); });
    const create = vi.fn(), publish = vi.fn();
    const client = { publishingLimits: async () => generousLimits(), status, create, publish };
    for (let i = 0; i < 6; i++) await processPost(env, row(), () => client as any);
    expect(status).toHaveBeenCalledTimes(5);
    expect(row()).toMatchObject({ status: 'needs_review', container_id: 'container', error_code: 'container_status_timeout', status_check_count: 5 });
    expect(create).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });
  it('keeps uncertain publish code 24/4279009 quarantined rather than assuming a safe retry', async () => {
    sqlite.prepare("UPDATE threads_posts SET status='processing',container_id='container'").run();
    const publish = vi.fn(async () => { throw new ThreadsError('threads_meta_24_4279009', 'not visible', 502, 24, 4279009, 400); });
    const client = { publishingLimits: async () => generousLimits(), status: async () => ({ status: 'FINISHED' }), publish };
    await processPost(env, row(), () => client as any); await processPost(env, row(), () => client as any);
    expect(row().status).toBe('needs_review'); expect(publish).toHaveBeenCalledTimes(1);
  });
  it('drops unknown upstream container text and preserves only documented enum values', async () => {
    const api = new ThreadsApi('token', vi.fn(async () => Response.json({ status: 'ERROR', error_message: 'secret-token' })));
    expect(await api.status('container')).toEqual({ status: 'ERROR', error_message: null });
  });
});
it('stores shares separately, preserves missing metrics as null, and returns their measured count', async () => {
  sqlite.prepare("UPDATE threads_posts SET status='published',published_id='pub'").run();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ name: 'shares', values: [{ value: 0 }] }, { name: 'likes', values: [{ value: 7 }] }] })));
  expect((await request('/posts/draft/insights', 'POST')).status).toBe(200);
  expect(row()).toMatchObject({ shares: 0, likes: 7, views: null });
  expect((await (await request('/insights?accountId=123')).json() as any).data).toMatchObject({ shares: 0, shares_measured: 1 });
});
it('enforces the shared emoji limit at the draft API boundary', async () => {
  expect((await request('/posts', 'POST', { accountId: '123', text: '😀'.repeat(126) })).status).toBe(400);
  expect((await request('/posts', 'POST', { accountId: '123', text: '😀'.repeat(125) })).status).toBe(201);
});

describe('media drafts and safe publication', () => {
  const image = { type: 'IMAGE', url: 'https://cdn.example.com/image.png' };
  const video = { type: 'VIDEO', url: 'https://cdn.example.com/video.mp4' };
  const mediaClient = () => ({
    publishingLimits: vi.fn(async () => ({ posts: { remaining: 250 } })),
    create: vi.fn(async () => '101'), createMediaChild: vi.fn(async () => '201'),
    createCarousel: vi.fn(async () => '301'), status: vi.fn(async () => ({ status: 'FINISHED' })),
    publish: vi.fn(async () => '401'),
  });
  const draft = async (media: unknown[], text = '') => {
    const response = await request('/posts', 'POST', { accountId: '123', text, media });
    expect(response.status).toBe(201);
    return (await response.json() as any).data.id;
  };
  it('saves blank captions, edits media, preserves it on text-only patch and rejects invalid URLs', async () => {
    const id = await draft([image]);
    expect(JSON.parse(row(id).media_json)).toEqual([image]);
    expect((await request(`/posts/${id}`, 'PATCH', { text: 'caption' })).status).toBe(200);
    expect(JSON.parse(row(id).media_json)).toEqual([image]);
    expect((await request(`/posts/${id}`, 'PATCH', { media: [video, image] })).status).toBe(200);
    expect(JSON.parse(row(id).media_json)).toEqual([video, image]);
    for (const media of [[{ ...image, url: 'http://localhost/a' }], Array(21).fill(image), [{ type: 'TEXT', url: image.url }]]) {
      expect((await request('/posts', 'POST', { accountId: '123', media })).status).toBe(400);
    }
    expect((await request('/posts', 'POST', { accountId: '123', text: '', media: [] })).status).toBe(400);
  });
  it('queues, cancels and archives complete mixed-media chains without contacting publishing endpoints', async () => {
    const res = await request('/chains', 'POST', { accountId: '123', parts: ['text', { text: '', media: [image, video] }] });
    expect(res.status).toBe(201);
    const { ids } = (await res.json() as any).data;
    expect(row(ids[1]).parent_id).toBe(ids[0]);
    expect((await request(`/posts/${ids[0]}/queue`, 'POST', { scheduledAt: new Date(Date.now()+3600000).toISOString() })).status).toBe(200);
    expect((await request(`/posts/${ids[1]}`, 'PATCH', { media: [video] })).status).toBe(409);
    expect((await request(`/posts/${ids[0]}/cancel`, 'POST', {})).status).toBe(200);
    expect(row(ids[1]).status).toBe('draft');
    expect((await request(`/posts/${ids[0]}/archive`, 'POST', {})).status).toBe(200);
    expect(row(ids[1]).status).toBe('archived');
  });
  it.each([image, video])('publishes one $type only after readiness and keeps optional caption', async media => {
    const id = await draft([media]);
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    const client = mediaClient();
    await processPost(env, row(id), () => client as any);
    expect(client.create).toHaveBeenCalledWith('123', '', undefined, media);
    expect(client.publish).not.toHaveBeenCalled();
    expect(row(id).container_id).toBe('101');
    client.status.mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    await processPost(env, row(id), () => client as any);
    expect(row(id).status).toBe('processing');
    expect(client.publish).not.toHaveBeenCalled();
    await processPost(env, row(id), () => client as any);
    expect(row(id).published_id).toBe('401');
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.publish).toHaveBeenCalledTimes(1); expect(client.publish).toHaveBeenCalledWith('123', '101');
  });
  it('builds all 20 mixed children in bounded batches, preserving order across ticks before one parent publish', async () => {
    const media = Array.from({length:20},(_,i)=>i%2?video:image);
    const id = await draft(media, 'album');
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    const client = mediaClient(); let created = 0;
    client.createMediaChild.mockImplementation(async () => String(200 + ++created));
    for (let tick=0;tick<30 && row(id).status!=='published';tick++) {
      const before = client.createMediaChild.mock.calls.length;
      await processPost(env, row(id), () => client as any);
      expect(client.createMediaChild.mock.calls.length-before).toBeLessThanOrEqual(3);
    }
    expect(client.createMediaChild).toHaveBeenCalledTimes(20);
    expect(client.createCarousel).toHaveBeenCalledTimes(1); expect(client.createCarousel).toHaveBeenCalledWith('123','album',Array.from({length:20},(_,i)=>String(201+i)),undefined);
    expect(client.publish).toHaveBeenCalledTimes(1); expect(client.publish).toHaveBeenCalledWith('123','301');
    expect(row(id).status).toBe('published');
  });
  it('waits for a video child without recreating children or creating the parent early', async () => {
    const id = await draft([image,video]); const client=mediaClient();
    client.createMediaChild.mockResolvedValueOnce('201').mockResolvedValueOnce('202');
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    await processPost(env,row(id),()=>client as any);
    client.status.mockResolvedValueOnce({status:'FINISHED'}).mockResolvedValueOnce({status:'IN_PROGRESS'});
    await processPost(env,row(id),()=>client as any);
    expect(client.createCarousel).not.toHaveBeenCalled();
    expect(JSON.parse(row(id).media_children_json)[0].ready).toBe(true);
    await processPost(env,row(id),()=>client as any);
    expect(client.createMediaChild).toHaveBeenCalledTimes(2);
    expect(client.createCarousel).toHaveBeenCalledTimes(1);
    expect(client.publish).not.toHaveBeenCalled();
    await processPost(env,row(id),()=>client as any);
    expect(row(id).status).toBe('published');
  });
  it('quarantines an uncertain child create and preserves confirmed earlier IDs', async () => {
    const id=await draft([image,video]); const client=mediaClient();
    client.createMediaChild.mockResolvedValueOnce('201').mockRejectedValueOnce(new Error('network uncertainty'));
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    await processPost(env,row(id),()=>client as any);
    expect(row(id).status).toBe('needs_review');
    expect(JSON.parse(row(id).media_children_json).map((c:any)=>c.id)).toEqual(['201']);
    await processPost(env,row(id),()=>client as any);
    expect(client.createMediaChild).toHaveBeenCalledTimes(2);
    expect(client.publish).not.toHaveBeenCalled();
  });
  it.each(['ERROR','EXPIRED'])('does not publish an album containing a %s child', async status => {
    const id=await draft([image,video]); const client=mediaClient();
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    await processPost(env,row(id),()=>client as any);
    client.status.mockResolvedValueOnce({status});
    await processPost(env,row(id),()=>client as any);
    expect(row(id).status).toBe('failed');
    expect(client.createCarousel).not.toHaveBeenCalled(); expect(client.publish).not.toHaveBeenCalled();
  });
  it('retains children on invalid token and resumes creation without losing or recreating them', async () => {
    const id=await draft([image,video]); const client=mediaClient();
    client.createMediaChild.mockResolvedValueOnce('201').mockRejectedValueOnce(new ThreadsError('threads_meta_190','invalid',422,190));
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    await processPost(env,row(id),()=>client as any);
    expect(row(id).status).toBe('queued'); expect(JSON.parse(row(id).media_children_json)).toHaveLength(1);
    expect((sqlite.prepare('SELECT queue_paused FROM threads_accounts').get() as any).queue_paused).toBe(1);
    sqlite.prepare("UPDATE threads_accounts SET status='connected',queue_paused=0").run();
    client.createMediaChild.mockResolvedValueOnce('202');
    await processPost(env,row(id),()=>client as any);
    expect(JSON.parse(row(id).media_children_json).map((c:any)=>c.id)).toEqual(['201','202']);
  });
  it('bounds video polling and never retries an uncertain media publication', async () => {
    const id=await draft([video]); const client=mediaClient();
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(id);
    await processPost(env,row(id),()=>client as any);
    client.publish.mockRejectedValueOnce(new Error('timeout'));
    await processPost(env,row(id),()=>client as any);
    expect(row(id).status).toBe('needs_review');
    await processPost(env,row(id),()=>client as any);
    expect(client.publish).toHaveBeenCalledTimes(1);
    const slow=await draft([video]); sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(slow);
    await processPost(env,row(slow),()=>client as any);
    client.status.mockResolvedValue({status:'IN_PROGRESS'});
    for(let i=0;i<15;i++) await processPost(env,row(slow),()=>client as any);
    expect(row(slow).error_code).toBe('container_status_timeout');
    expect(row(slow).status).toBe('needs_review');
  });
});

it('bounds child 404 polling and never creates an album from an unreadable child', async () => {
  const media=[{type:'IMAGE',url:'https://cdn.example.com/a.png'},{type:'VIDEO',url:'https://cdn.example.com/b.mp4'}];
  sqlite.prepare("UPDATE threads_posts SET status='processing',media_json=?,media_children_json=? WHERE id='draft'").run(JSON.stringify(media),JSON.stringify([{id:'201',ready:true,checks:0},{id:'202',ready:false,checks:0}]));
  const client={publishingLimits:async()=>({posts:{remaining:250}}),status:vi.fn(async()=>{throw new ThreadsError('threads_http_404','not visible',502,undefined,undefined,404);}),createCarousel:vi.fn(),publish:vi.fn()};
  for(let i=0;i<15;i++) await processPost(env,row(),()=>client as any);
  expect(row().status).toBe('needs_review');expect(row().error_code).toBe('container_child_timeout');
  await processPost(env,row(),()=>client as any);
  expect(client.status).toHaveBeenCalledTimes(15);expect(client.createCarousel).not.toHaveBeenCalled();expect(client.publish).not.toHaveBeenCalled();
});

it('preserves child state across an alarm and wakes the next media batch promptly', async () => {
  sqlite.prepare("UPDATE threads_posts SET status='queued',scheduled_at=?,media_json=? WHERE id='draft'").run(new Date(Date.now()-1000).toISOString(),JSON.stringify(Array(4).fill({type:'IMAGE',url:'https://cdn.example.com/a.png'})));
  const child=vi.spyOn(ThreadsApi.prototype,'createMediaChild').mockResolvedValue('201');
  try {
    const storage={setAlarm:vi.fn(),getAlarm:async()=>null,deleteAlarm:vi.fn()};
    const before=Date.now(); await new ThreadsPublisher(schedulerState(storage) as any,env).alarm();
    expect(child).toHaveBeenCalledTimes(3);expect(JSON.parse(row().media_children_json)).toHaveLength(3);
    expect(row().status).toBe('processing');expect(storage.setAlarm.mock.lastCall?.[0]).toBeLessThan(before+10000);
  } finally { child.mockRestore(); }
});

it('discards unpublished preparation when cancelling a partially prepared, paused carousel', async () => {
  const oldMedia=[{type:'IMAGE',url:'https://cdn.example.com/old.png'},{type:'VIDEO',url:'https://cdn.example.com/old.mp4'}];
  sqlite.prepare("UPDATE threads_posts SET status='queued',media_json=? WHERE id='draft'").run(JSON.stringify(oldMedia));
  const client={publishingLimits:async()=>({posts:{remaining:250}}),createMediaChild:vi.fn().mockResolvedValueOnce('201').mockRejectedValueOnce(new ThreadsError('threads_meta_190','expired',422,190)),publish:vi.fn()};
  await processPost(env,row(),()=>client as any);
  expect(row().status).toBe('queued');expect(JSON.parse(row().media_children_json)).toHaveLength(1);
  expect((await request('/posts/draft/cancel','POST',{})).status).toBe(200);
  expect(row().status).toBe('draft');
  expect(JSON.parse(row().media_children_json)).toEqual([]);
  const replacement=[{type:'VIDEO',url:'https://cdn.example.com/new.mp4'},{type:'IMAGE',url:'https://cdn.example.com/new.png'}];
  expect((await request('/posts/draft','PATCH',{media:replacement})).status).toBe(200);
  sqlite.prepare("UPDATE threads_accounts SET status='connected',queue_paused=0").run();
  sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id='draft'").run();
  client.createMediaChild.mockResolvedValueOnce('301').mockResolvedValueOnce('302');
  await processPost(env,row(),()=>client as any);
  expect(client.createMediaChild.mock.calls.slice(2).map(call=>call[1])).toEqual(replacement);
  expect(JSON.parse(row().media_children_json).map((c:any)=>c.id)).toEqual(['301','302']);
  expect(row().published_id).toBeNull();expect(client.publish).not.toHaveBeenCalled();
});

describe('media interruption boundaries',()=>{
  const media=[{type:'IMAGE',url:'https://cdn.example.com/a.png'},{type:'VIDEO',url:'https://cdn.example.com/b.mp4'}];
  const children=[{id:'201',ready:true,checks:0},{id:'202',ready:true,checks:0}];
  function failWriteOnce(pattern: string) {
    const original=env.DB.prepare;let failed=false;
    env.DB.prepare=(sql:string)=>{
      const statement=original(sql),bind=statement.bind;
      statement.bind=(...args:unknown[])=>{
        const bound=bind(...args);
        if(sql.includes(pattern)) { const run=bound.run;bound.run=async()=>{if(!failed){failed=true;throw Error('injected D1 outage');}return run();}; }
        return bound;
      }; return statement;
    };
  }
  function setup(phase='processing') {
    sqlite.prepare('UPDATE threads_posts SET status=?,media_json=?,media_children_json=? WHERE id=?').run(phase,JSON.stringify(media),JSON.stringify(children),'draft');
    return {publishingLimits:vi.fn(async()=>({posts:{remaining:250}})),createMediaChild:vi.fn(async()=> '203'),createCarousel:vi.fn(async()=> '301'),status:vi.fn(async()=>({status:'FINISHED'})),publish:vi.fn(async()=> '401')};
  }
  it('never repeats a child create whose response could not be saved to D1',async()=>{
    const client=setup('queued'); sqlite.prepare("UPDATE threads_posts SET media_children_json='[]' WHERE id='draft'").run();
    failWriteOnce('SET media_children_json=?');
    await processPost(env,row(),()=>client as any);expect(row().status).toBe('needs_review');
    await processPost(env,row(),()=>client as any);expect(client.createMediaChild).toHaveBeenCalledTimes(1);expect(client.publish).not.toHaveBeenCalled();
  });
  it('never recreates a parent after an ambiguous creation response',async()=>{
    const client=setup();client.createCarousel.mockRejectedValueOnce(Error('timeout'));
    await processPost(env,row(),()=>client as any);expect(row().status).toBe('needs_review');
    await processPost(env,row(),()=>client as any);expect(client.createCarousel).toHaveBeenCalledTimes(1);expect(client.publish).not.toHaveBeenCalled();
    expect(JSON.parse(row().media_children_json)).toEqual(children);
  });
  it('never recreates a parent whose successful response could not be persisted',async()=>{
    const client=setup();failWriteOnce("SET status='processing', container_id=?");
    await processPost(env,row(),()=>client as any);expect(row().status).toBe('needs_review');
    await processPost(env,row(),()=>client as any);expect(client.createCarousel).toHaveBeenCalledTimes(1);expect(client.publish).not.toHaveBeenCalled();
  });
  it('does not repeat an already-successful publish if the receipt save fails',async()=>{
    const client=setup();sqlite.prepare("UPDATE threads_posts SET container_id='301' WHERE id='draft'").run();
    failWriteOnce("SET status='published', published_id=?");
    await processPost(env,row(),()=>client as any);expect(row().status).toBe('needs_review');
    await processPost(env,row(),()=>client as any);expect(client.publish).toHaveBeenCalledTimes(1);
    expect(row().container_id).toBe('301');
  });
  it('preserves prepared children during quota exhaustion without creating or publishing',async()=>{
    const client=setup();client.publishingLimits.mockResolvedValue({posts:{remaining:0}});
    await processPost(env,row(),()=>client as any);
    expect(row().status).toBe('processing');expect(row().error_code).toBe('quota_exhausted');
    expect(JSON.parse(row().media_children_json)).toEqual(children);expect(client.createCarousel).not.toHaveBeenCalled();expect(client.publish).not.toHaveBeenCalled();
    expect(Date.parse(row().next_attempt_at)).toBeGreaterThan(Date.now()+290000);
  });
  it('pauses on child-status token failure, retaining all previously prepared IDs for explicit resume',async()=>{
    const client=setup();sqlite.prepare('UPDATE threads_posts SET media_children_json=? WHERE id=?').run(JSON.stringify(children.map(c=>({...c,ready:false}))),'draft');
    client.status.mockRejectedValueOnce(new ThreadsError('threads_meta_190','invalid',422,190));
    await processPost(env,row(),()=>client as any);
    expect(row().status).toBe('processing');expect((sqlite.prepare('SELECT queue_paused FROM threads_accounts').get() as any).queue_paused).toBe(1);
    expect(JSON.parse(row().media_children_json).map((c:any)=>c.id)).toEqual(['201','202']);expect(client.createCarousel).not.toHaveBeenCalled();
    sqlite.prepare("UPDATE threads_accounts SET status='connected',queue_paused=0").run();
    await processPost(env,row(),()=>client as any);expect(client.createCarousel).toHaveBeenCalledWith('123','Hello',['201','202'],undefined);expect(client.createMediaChild).not.toHaveBeenCalled();
  });
  it.each(['PUBLISHED','UNKNOWN'])('quarantines unexpected child status %s instead of building a parent',async status=>{
    const client=setup();sqlite.prepare('UPDATE threads_posts SET media_children_json=? WHERE id=?').run(JSON.stringify(children.map(c=>({...c,ready:false}))),'draft');
    client.status.mockResolvedValue({status});await processPost(env,row(),()=>client as any);
    expect(row().status).toBe('needs_review');expect(client.createCarousel).not.toHaveBeenCalled();expect(client.publish).not.toHaveBeenCalled();
  });
  it('keeps the history of all chain parts on a failed partial cancellation',async()=>{
    const res=await request('/chains','POST',{accountId:'123',parts:['first',{text:'second',media}]});
    const {ids}=(await res.json() as any).data;
    sqlite.prepare("UPDATE threads_posts SET status='queued' WHERE id=?").run(ids[0]);
    sqlite.prepare("UPDATE threads_posts SET status='processing',media_children_json=? WHERE id=?").run(JSON.stringify(children),ids[1]);
    expect((await request(`/posts/${ids[0]}/cancel`,'POST',{})).status).toBe(409);
    expect(row(ids[0]).status).toBe('queued');expect(row(ids[1]).status).toBe('processing');expect(JSON.parse(row(ids[1]).media_children_json)).toEqual(children);
  });
});
