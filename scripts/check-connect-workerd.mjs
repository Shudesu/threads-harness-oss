// Local-only regression check using the existing Mac workspace dependencies.
// Synthetic credentials, an ephemeral D1, and intercepted outbound requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';

const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: "import { app } from './src/index'; export { ThreadsPublisher } from './src/index'; export default app;", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser',
});
let outboundCalls = 0, rejectQuota = false;
const options = {
  modules: true, script: outputFiles[0].text,
  // The installed workerd supports dates through 2026-08-27; production uses 2026-09-01.
  compatibilityDate: '2026-08-27',
  d1Databases: ['DB'],
  durableObjects: { PUBLISHER: { className: 'ThreadsPublisher', useSQLite: true } },
  bindings: { API_KEY: 'fixture-workspace-key', TOKEN_ENCRYPTION_KEY: btoa('12345678901234567890123456789012') },
  outboundService(request) {
    outboundCalls++;
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://graph.threads.net');
    assert.ok(['/v1.0/me', '/v1.0/debug_token', '/v1.0/456/threads_publishing_limit'].includes(url.pathname));
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('Authorization'), 'Bearer fixture-token');
    if (url.pathname.endsWith('/threads_publishing_limit') && rejectQuota) return Response.json({ error: { code: 190, message: 'fixture-token must not leak' } }, { status: 400 });
    if (url.pathname.endsWith('/threads_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250, quota_duration: 86400 } }] });
    return url.pathname.endsWith('/me') ? Response.json({ id: '456', username: 'fixture' }) : Response.json({ data: { type: 'USER', user_id: '456', is_valid: true, scopes: ['threads_basic','threads_content_publish','threads_manage_insights'], expires_at: Math.floor(Date.now()/1000)+3600 } });
  },
};
const mf = new miniflare.Miniflare(miniflare.convertV4MiniflareOptions ? miniflare.convertV4MiniflareOptions(options) : options);
try {
  const db = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0002_admin_sso.sql', '0003_chains_insights.sql', '0004_connection_health.sql', '0005_account_schedulers.sql', '0006_publication_safety.sql']) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^\s*--[^\n]*/gm, '').split(';').filter(s => s.trim())) await db.prepare(statement).run();
  }
  const request = (path, method = 'GET', body) => mf.dispatchFetch(`http://localhost/api${path}`, {
    method, headers: { Authorization: 'Bearer fixture-workspace-key', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.deepEqual((await (await request('/accounts')).json()).data, []);
  const connected = await request('/accounts', 'POST', { accessToken: 'fixture-token' });
  assert.equal(connected.status, 201);
  assert.equal(outboundCalls, 3);
  const accounts = await (await request('/accounts')).json();
  assert.equal(accounts.data.length, 1);
  assert.equal(accounts.data[0].id, '456');
  assert.equal(accounts.data[0].status, 'connected');
  assert.ok(!JSON.stringify(accounts).includes('fixture-token'));
  assert.ok(!JSON.stringify(accounts).includes('token_cipher'));
  const cipher = await db.prepare('SELECT token_cipher FROM threads_accounts WHERE id=?').bind('456').first('token_cipher');
  assert.ok(typeof cipher === 'string' && cipher.length > 0 && !cipher.includes('fixture-token'));
  const draft = await request('/posts', 'POST', { accountId: '456', text: 'Private fixture draft' });
  assert.equal(draft.status, 201);
  const posts = await (await request('/posts?accountId=456')).json();
  assert.equal(posts.data.length, 1);
  assert.equal(posts.data[0].status, 'draft');
  assert.equal(posts.data[0].published_id, null);
  assert.equal(outboundCalls, 3);
  const postId = posts.data[0].id;
  rejectQuota = true;
  const deniedQueue = await request(`/posts/${postId}/queue`, 'POST', {});
  assert.equal(deniedQueue.status, 422);
  const denied = await deniedQueue.json();
  assert.equal(denied.kind, 'token_invalid');
  assert.ok(!JSON.stringify(denied).includes('fixture-token'));
  rejectQuota = false;
  assert.equal((await request('/accounts', 'POST', { accessToken: 'fixture-token' })).status, 201);
  assert.equal((await request('/accounts/456/resume', 'POST', { confirmed: true })).status, 200);
  const queued = await request(`/posts/${postId}/queue`, 'POST', { scheduledAt: new Date(Date.now() + 600000).toISOString() });
  assert.equal(queued.status, 200);
  assert.equal((await db.prepare('SELECT status FROM threads_posts WHERE id=?').bind(postId).first()).status, 'queued');
  assert.equal((await request('/posts', 'POST', { accountId: '456', text: '😀'.repeat(126) })).status, 400);
  console.log(JSON.stringify({ connectionStatus: connected.status, accounts: 1, draftStatus: draft.status, drafts: 1, durableObjectQueueStatus: queued.status, preservedErrorKind: denied.kind, outboundReadOnlyChecks: outboundCalls, publications: 0 }));
} finally {
  await mf.dispose();
}
