import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { app, accountIdentity, ThreadsPublisher } from '../src/index';
import { seal, unseal, ThreadsError } from '../src/threads';

const secret = btoa('12345678901234567890123456789012');
let sqlite: InstanceType<typeof Database>;
let env: any;
let publisherCalls: string[];
let logs: string[];
const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const call = (path: string, method = 'GET', body?: unknown, authorized = true) => app.request(`https://test/api${path}`, { method, headers: { ...(authorized ? { Authorization: 'Bearer workspace-key' } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
const mgmt = (path: string, method = 'GET', body?: unknown, authorized = true) => call(`/account-management/v1${path}`, method, body, authorized);
let sequence = 0;
const opId = () => `op-${String(++sequence).padStart(4, '0')}-abcdefghijkl`;
const operation = (body: Record<string, unknown>) => mgmt('/operations', 'POST', body);
const account = (id = '123') => sqlite.prepare('SELECT * FROM threads_accounts WHERE id=?').get(id) as any;
const revision = (id = '123') => String(account(id).mgmt_revision);
const op = (action: string, input: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  ({ operationId: opId(), action, accountId: '123', expectedRevision: revision(), expectedSubject: '123', input, ...overrides });
const identity = (id = '123', username = 'owner') => vi.spyOn(accountIdentity, 'verify').mockImplementation(async () => ({ id, username, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), dataAccessExpiresAt: null }));

beforeEach(async () => {
  sqlite = new Database(':memory:');
  for (const file of migrations) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  // No real network: any unexpected Meta request fails the test.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request in test'); }));
  logs = [];
  for (const level of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  const adapt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...values: unknown[]) => adapt(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
  });
  publisherCalls = [];
  env = { DB: { prepare: adapt, batch: async (statements: any[]) => sqlite.transaction(() => statements.map(s => ({ meta: { changes: sqlite.prepare(s.sql).run(...s.args).changes } })))() }, API_KEY: 'workspace-key', TOKEN_ENCRYPTION_KEY: secret,
    PUBLISHER: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init: RequestInit) => { publisherCalls.push(`${name} ${url}`); return new ThreadsPublisher({ storage: { get: async () => undefined, put: async () => {}, setAlarm: vi.fn(), getAlarm: async () => null, deleteAlarm: vi.fn() }, blockConcurrencyWhile: (fn: () => Promise<unknown>) => fn() } as any, env).fetch(new Request(url, init)); } }) } };
  sqlite.prepare('INSERT INTO threads_accounts (id,username,token_cipher,created_at,updated_at) VALUES (?,?,?,?,?)').run('123', 'owner', await seal('private-token', secret), '2026-10-11', '2026-10-11');
  sqlite.prepare('INSERT INTO threads_posts (id,account_id,text,status,scheduled_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('queued', '123', 'Hello', 'queued', '2026-10-12', '2026-10-11', '2026-10-11');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sqlite.close(); });

describe('migration 0008', () => {
  it('assigns distinct non-zero revisions to pre-existing rows and seeds the global sequence', () => {
    const db = new Database(':memory:');
    for (const file of migrations.filter(f => f < '0008')) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    for (const id of ['1', '2']) db.prepare('INSERT INTO threads_accounts (id,username,created_at,updated_at) VALUES (?,?,?,?)').run(id, 'u' + id, 'x', 'x');
    db.exec(readFileSync(new URL('../migrations/0008_account_management.sql', import.meta.url), 'utf8'));
    const rows = db.prepare('SELECT mgmt_revision FROM threads_accounts ORDER BY id').all() as any[];
    expect(rows.map(r => r.mgmt_revision)).toEqual([1, 2]);
    expect(db.prepare('SELECT value FROM account_mgmt_sequence').get()).toEqual({ value: 2 });
    db.prepare('UPDATE threads_accounts SET username=? WHERE id=?').run('changed', '1');
    expect((db.prepare("SELECT mgmt_revision FROM threads_accounts WHERE id='1'").get() as any).mgmt_revision).toBe(3);
    db.close();
  });
});

describe('account-mgmt/v1 read', () => {
  it('requires the workspace key and exposes revision/subject without any secret material', async () => {
    expect((await mgmt('/accounts', 'GET', undefined, false)).status).toBe(401);
    expect((await operation(op('deactivate'))).status).toBe(200);
    const response = await mgmt('/accounts');
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.data.contract).toBe('account-mgmt/v1');
    expect(body.data.accounts).toEqual([{ id: '123', subject: '123', revision: revision(), name: 'owner', username: 'owner', isActive: false, isDefault: false, needsReauth: false, status: 'connected', actions: ['update_settings', 'activate', 'disconnect', 'reconnect'] }]);
    expect(typeof body.data.accounts[0].revision).toBe('string');
    for (const leak of ['token', 'cipher', account().token_cipher, 'private-token']) expect(text).not.toContain(leak);
  });
});

describe('account-mgmt/v1 create', () => {
  it('verifies /me, stores the token encrypted like the legacy connect, and commits the receipt', async () => {
    const verify = identity('456', 'second');
    const response = await operation({ operationId: 'create-op-000000001', action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: '  new-secret-token  ', name: 'Brand B' } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('new-secret-token');
    const data = JSON.parse(text).data;
    expect(data).toEqual({ contract: 'account-mgmt/v1', operationId: 'create-op-000000001', action: 'create', accountId: '456', revision: revision('456'), replayed: false });
    expect(verify).toHaveBeenCalledWith('new-secret-token', expect.anything());
    const row = account('456');
    expect(row).toMatchObject({ username: 'second', display_name: 'Brand B', status: 'connected', is_active: 1, queue_paused: 0 });
    expect(row.token_cipher).not.toContain('new-secret-token');
    expect(await unseal(row.token_cipher, secret)).toBe('new-secret-token');
    const receipt = sqlite.prepare('SELECT * FROM account_mgmt_receipts').get() as any;
    expect(String(receipt.result_revision)).toBe(data.revision);
    expect(JSON.stringify(receipt)).not.toContain('new-secret-token');
    expect(JSON.stringify(receipt)).not.toContain('Brand B');
    expect(logs.join('\n')).not.toContain('new-secret-token');
  });
  it('accepts the exact Cloud create input {accessToken}, matches the Cloud id/subject/revision formats and appears in the legacy list', async () => {
    identity('456', 'second');
    const response = await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'only-token' } });
    expect(response.status).toBe(200);
    expect(account('456').display_name).toBeNull();
    const managed = (await (await mgmt('/accounts')).json()).data.accounts;
    for (const a of managed) {
      expect(a.id).toMatch(/^[a-zA-Z0-9_-]{1,200}$/);
      expect(a.subject).toMatch(/^[A-Za-z0-9_.:-]{1,128}$/);
      expect(a.revision).toMatch(/^[1-9][0-9]*$/);
    }
    expect(managed.find((a: any) => a.id === '456')).toMatchObject({ name: 'second', status: 'connected' });
    const legacy = (await (await call('/accounts')).json()).data;
    expect(legacy.find((a: any) => a.id === '456')).toMatchObject({ username: 'second', status: 'connected' });
  });
  it('rejects an existing subject with 409 account_exists and never upserts', async () => {
    const verify = identity('123');
    const before = account();
    const response = await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '123', input: { accessToken: 'other-token' } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'account_exists', code: 'account_exists' });
    expect(account()).toEqual(before);
    expect(verify).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
  it('rejects a token whose /me identity differs from expectedSubject', async () => {
    identity('999');
    const response = await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'someone-else' } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('subject_mismatch');
    expect(account('456')).toBeUndefined();
    expect(account('999')).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
  it('turns an INSERT conflict racing between the pre-check and the batch into 409, without a receipt', async () => {
    vi.spyOn(accountIdentity, 'verify').mockImplementation(async () => {
      // A legacy connect lands for the same subject while /me is in flight.
      sqlite.prepare('INSERT INTO threads_accounts (id,username,token_cipher,created_at,updated_at) VALUES (?,?,?,?,?)').run('456', 'raced', 'legacy-cipher', 'x', 'x');
      return { id: '456', username: 'mine', tokenExpiresAt: null, dataAccessExpiresAt: null };
    });
    const operationId = opId();
    const response = await operation({ operationId, action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'race-token' } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('account_exists');
    expect(account('456')).toMatchObject({ username: 'raced', token_cipher: 'legacy-cipher' });
    expect((await mgmt(`/operations/${operationId}`)).status).toBe(404);
  });
  it('maps identity verification failures to a code without upstream text, and writes nothing', async () => {
    vi.spyOn(accountIdentity, 'verify').mockRejectedValue(new ThreadsError('threads_meta_190', 'upstream says private detail', 422, 190));
    const response = await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'bad-token' } });
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: 'credential_invalid', code: 'credential_invalid' });
    expect(text).not.toContain('private detail');
    vi.spyOn(accountIdentity, 'verify').mockRejectedValue(new ThreadsError('connection_check_failed', 'x'));
    expect((await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'bad-token' } })).status).toBe(502);
    expect(account('456')).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
  it('uses the real /me lookup through the injectable verifier (mocked fetch only)', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/me?')) return Response.json({ id: '456', username: 'via-me' });
      if (url.includes('/debug_token?')) return Response.json({ data: { type: 'USER', user_id: '456', is_valid: true, scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'], expires_at: Math.floor(Date.now() / 1000) + 3600 } });
      if (url.includes('/threads_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250, quota_duration: 86400 } }] });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await operation({ operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'fresh' } })).status).toBe(200);
    expect(account('456').username).toBe('via-me');
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('https://graph.threads.net/'))).toBe(true);
  });
});

describe('account-mgmt/v1 account actions', () => {
  it('reconnects the same subject with a new encrypted token and keeps the publication queue paused', async () => {
    sqlite.prepare("UPDATE threads_accounts SET status='reauth_required', queue_paused=1, last_error_code='threads_meta_190'").run();
    identity('123', 'renamed-user');
    const before = revision();
    const response = await operation(op('reconnect', { accessToken: 'rotated-token' }));
    expect(response.status).toBe(200);
    expect(Number((await response.json()).data.revision)).toBeGreaterThan(Number(before));
    expect(account()).toMatchObject({ status: 'connected', username: 'renamed-user', queue_paused: 1, last_error_code: null });
    expect(await unseal(account().token_cipher, secret)).toBe('rotated-token');
    expect(publisherCalls).toEqual([]);
  });
  it('refuses a reconnect token belonging to a different Threads user', async () => {
    identity('777');
    const before = account();
    const response = await operation(op('reconnect', { accessToken: 'other-users-token' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('subject_mismatch');
    expect(account()).toEqual(before);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
  it('updates only the allow-listed display name', async () => {
    const response = await operation(op('update_settings', { name: '  Brand A  ' }));
    expect(response.status).toBe(200);
    expect(account().display_name).toBe('Brand A');
    expect((await (await mgmt('/accounts')).json()).data.accounts[0].name).toBe('Brand A');
    expect((await operation(op('update_settings', { name: null }))).status).toBe(200);
    expect(account().display_name).toBeNull();
    expect((await operation(op('update_settings', { displayName: 'Alias Label' }))).status).toBe(200);
    expect(account().display_name).toBe('Alias Label');
    expect((await operation(op('update_settings', { name: 'Same', displayName: 'Same' }))).status).toBe(200);
    expect(account().display_name).toBe('Same');
    expect((await operation(op('update_settings', { name: 'A', displayName: 'B' }))).status).toBe(400);
    expect((await operation(op('update_settings', { displayName: 7 }))).status).toBe(400);
    for (const input of [{ username: 'x' }, { status: 'connected' }, { name: 'ok', is_active: 1 }, {}, { name: '' }, { name: 'x'.repeat(101) }, { accessToken: 't' }]) {
      const rejected = await operation(op('update_settings', input));
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).error).toBe('invalid_request');
    }
  });
  it('deactivates logically, and activate does not resume or trigger queued publication', async () => {
    expect((await operation(op('deactivate'))).status).toBe(200);
    expect(account()).toMatchObject({ is_active: 0, queue_paused: 1 });
    // The legacy explicit resume refuses a deactivated account.
    const resumed = await call('/accounts/123/resume', 'POST', { confirmed: true });
    expect(resumed.status).toBe(409);
    expect(account().queue_paused).toBe(1);
    publisherCalls = [];
    const fetcher = vi.fn(async () => { throw new Error('no publication'); });
    vi.stubGlobal('fetch', fetcher);
    const response = await operation(op('activate'));
    expect(response.status).toBe(200);
    expect(account()).toMatchObject({ is_active: 1, queue_paused: 1 });
    expect(publisherCalls).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect((sqlite.prepare("SELECT status FROM threads_posts WHERE id='queued'").get() as any).status).toBe('queued');
    // Resuming publication stays a separate explicit legacy step and is not an action.
    const unsupported = await operation(op('resume'));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toBe('unsupported_action');
  });
  it('disconnects with CAS: clears the token, keeps the row and queued posts unpublished', async () => {
    const response = await operation(op('disconnect'));
    expect(response.status).toBe(200);
    expect(account()).toMatchObject({ id: '123', status: 'disconnected', token_cipher: null, queue_paused: 1 });
    expect((sqlite.prepare("SELECT status FROM threads_posts WHERE id='queued'").get() as any).status).toBe('queued');
    expect((await (await mgmt('/accounts')).json()).data.accounts[0]).toMatchObject({ needsReauth: true, status: 'disconnected', actions: ['update_settings', 'deactivate', 'reconnect'] });
  });
  it('does not support set_default (Threads has no default-account concept)', async () => {
    const response = await operation(op('set_default'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('unsupported_action');
  });
});

describe('account-mgmt/v1 CAS and receipts', () => {
  it('rejects a stale revision, a wrong subject and an unknown account without writing', async () => {
    const stale = revision();
    sqlite.prepare("UPDATE threads_accounts SET last_error_code='x'").run();
    const before = account();
    const conflict = await operation(op('deactivate', {}, { expectedRevision: stale }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ success: false, error: 'revision_conflict', code: 'revision_conflict' });
    expect((await operation(op('deactivate', {}, { expectedSubject: '999' }))).status).toBe(409);
    const missing = await operation(op('deactivate', {}, { accountId: '555', expectedSubject: '555' }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('account_not_found');
    expect(account()).toEqual(before);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
  it('rejects a write whose revision changed between the pre-check and the batch (CAS in the batch)', async () => {
    const body = op('update_settings', { name: 'late' });
    const batch = env.DB.batch;
    env.DB.batch = async (statements: any[]) => { sqlite.prepare("UPDATE threads_accounts SET last_error_code='concurrent'").run(); return batch(statements); };
    const response = await operation(body);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('revision_conflict');
    expect(account().display_name).toBeNull();
    expect((await mgmt(`/operations/${body.operationId}`)).status).toBe(404);
  });
  it('gives a deleted and recreated account a new revision (ABA)', async () => {
    const original = revision();
    sqlite.prepare("DELETE FROM threads_posts").run();
    sqlite.prepare("DELETE FROM threads_accounts WHERE id='123'").run();
    sqlite.prepare('INSERT INTO threads_accounts (id,username,token_cipher,created_at,updated_at) VALUES (?,?,?,?,?)').run('123', 'owner', 'c', 'x', 'x');
    expect(Number(revision())).toBeGreaterThan(Number(original));
    const response = await operation(op('deactivate', {}, { expectedRevision: original }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('revision_conflict');
  });
  it('bumps the revision on every legacy write path (connect upsert, check, failure record, resume, disconnect)', async () => {
    identity('123');
    const seen = [Number(revision())];
    const step = async (fn: () => Promise<unknown>) => { await fn(); seen.push(Number(revision())); };
    await step(async () => expect((await call('/accounts', 'POST', { accessToken: 'legacy-token' })).status).toBe(201));
    await step(async () => expect((await call('/accounts/123/check', 'POST')).status).toBe(200));
    await step(async () => {
      vi.spyOn(accountIdentity, 'verify').mockRejectedValueOnce(new ThreadsError('threads_meta_190', 'x', 422, 190));
      expect((await call('/accounts/123/check', 'POST')).status).toBe(422);
    });
    identity('123');
    await step(async () => expect((await call('/accounts', 'POST', { accessToken: 'legacy-token-2' })).status).toBe(201));
    await step(async () => expect((await call('/accounts/123/resume', 'POST', { confirmed: true })).status).toBe(200));
    await step(async () => expect((await call('/accounts/123/disconnect', 'POST', {})).status).toBe(200));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(account()).toMatchObject({ status: 'disconnected', token_cipher: null });
  });
  it('replays a duplicate operationId without re-executing and rejects reuse with a different request', async () => {
    const body = op('update_settings', { name: 'First' });
    const first = await (await operation(body)).json();
    sqlite.prepare("UPDATE threads_accounts SET display_name='changed elsewhere'").run();
    const again = await operation(body);
    expect(again.status).toBe(200);
    expect((await again.json()).data).toEqual({ ...first.data, replayed: true });
    expect(account().display_name).toBe('changed elsewhere');
    // Same key names, different value: values are not part of the fingerprint.
    expect((await operation({ ...body, input: { name: 'Other' } })).status).toBe(200);
    const conflict = await operation({ ...body, action: 'deactivate', input: {} });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe('operation_conflict');
    expect((await operation({ ...body, expectedRevision: revision() })).status).toBe(409);
  });
  it('replays a create without calling /me again', async () => {
    const verify = identity('456');
    const body = { operationId: opId(), action: 'create', accountId: null, expectedRevision: null, expectedSubject: '456', input: { accessToken: 'tok' } };
    expect((await operation(body)).status).toBe(200);
    const replay = await operation(body);
    expect((await replay.json()).data.replayed).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('looks up receipts by operationId', async () => {
    const body = op('deactivate');
    await operation(body);
    const found = await mgmt(`/operations/${body.operationId}`);
    expect(found.status).toBe(200);
    expect((await found.json()).data).toEqual({ operationId: body.operationId, action: 'deactivate', accountId: '123', revision: revision() });
    const missing = await mgmt('/operations/never-seen-operation-1');
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('receipt_not_found');
    expect((await mgmt('/operations/short')).status).toBe(400);
    expect((await mgmt(`/operations/${body.operationId}`, 'GET', undefined, false)).status).toBe(401);
  });
  it('rejects unauthenticated mutations and strict-validates the envelope', async () => {
    const before = account();
    expect((await mgmt('/operations', 'POST', op('deactivate'), false)).status).toBe(401);
    const base = op('deactivate');
    const invalid: unknown[] = [
      'not json', [], { ...base, extra: true }, { ...base, input: { unknown: 1 } }, (({ input, ...rest }) => rest)(base),
      { ...base, operationId: 'short' }, { ...base, operationId: 'bad id with spaces!!' }, { ...base, expectedRevision: 17 },
      { ...base, expectedRevision: '0' }, { ...base, expectedSubject: '' }, { ...base, accountId: null, expectedRevision: null },
      { ...base, action: 'create', input: { accessToken: 'x' } }, { ...base, action: 'reconnect', input: {} },
      { ...base, action: 'create', accountId: null, expectedRevision: null, input: { accessToken: 'x', token: 'y' } },
      { ...base, action: 'create', accountId: null, expectedRevision: null, input: { accessToken: ' ' } },
    ];
    for (const body of invalid) {
      const response = await operation(body as any);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toBe('invalid_request');
    }
    expect(account()).toEqual(before);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM account_mgmt_receipts').get()).toEqual({ n: 0 });
  });
});
