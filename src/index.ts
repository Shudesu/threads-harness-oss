import { Hono } from 'hono';
import { ThreadsApi, seal, unseal } from './threads';
import { adminSso } from './admin-sso';

export interface Bindings {
  DB: D1Database; ASSETS: Fetcher; API_KEY: string; TOKEN_ENCRYPTION_KEY: string;
  PUBLISHER: DurableObjectNamespace; ADMIN_SSO_SECRET?: string;
}
type Post = { id: string; account_id: string; text: string; status: string; scheduled_at: string | null; container_id: string | null; published_id: string | null; parent_id?: string | null };
export const app = new Hono<{ Bindings: Bindings }>();
const now = () => new Date().toISOString();
const fail = (message: string) => ({ success: false, error: message });
const ok = (data: unknown) => ({ success: true, data });

app.onError(() => Response.json(fail('処理に失敗しました。保存状態を確認してください。'), { status: 500 }));
app.get('/health', c => c.json({ status: 'ok', product: 'threads', version: '0.1.0' }));
app.route('/', adminSso);
app.use('/api/*', async (c, next) => {
  if (!c.env.API_KEY) return c.json(fail('Service not configured'), 503);
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? '';
  const hash = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([hash(token), hash(c.env.API_KEY)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) return c.json(fail('Unauthorized'), 401);
  c.header('Cache-Control', 'no-store');
  return next();
});
app.get('/api/accounts', async c => c.json(ok((await c.env.DB.prepare('SELECT id, username, status, created_at, updated_at FROM threads_accounts ORDER BY created_at DESC').all()).results)));
app.post('/api/accounts', async c => {
  if (!c.env.TOKEN_ENCRYPTION_KEY) return c.json(fail('Token encryption is not configured'), 503);
  const { accessToken } = await c.req.json();
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096) return c.json(fail('Threadsアクセストークンを入力してください'), 400);
  const profile = await new ThreadsApi(accessToken).profile();
  const cipher = await seal(accessToken, c.env.TOKEN_ENCRYPTION_KEY);
  await c.env.DB.prepare("INSERT INTO threads_accounts (id, username, token_cipher, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, token_cipher = excluded.token_cipher, status = 'connected', updated_at = excluded.updated_at")
    .bind(profile.id, profile.username, cipher, now(), now()).run();
  return c.json(ok(profile), 201);
});
app.post('/api/accounts/:id/disconnect', async c => {
  await c.env.DB.prepare("UPDATE threads_accounts SET status = 'disconnected', token_cipher = NULL, updated_at = ? WHERE id = ?").bind(now(), c.req.param('id')).run();
  return c.json(ok({ disconnected: true }));
});
app.get('/api/posts', async c => {
  const account = c.req.query('accountId');
  if (!account) return c.json(fail('accountId required'), 400);
  return c.json(ok((await c.env.DB.prepare("SELECT * FROM threads_posts WHERE account_id = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 200").bind(account).all()).results));
});
const validText = (text: unknown): text is string => typeof text === 'string' && text.trim().length > 0 && [...text].length <= 500;
app.post('/api/posts', async c => {
  const { text, accountId } = await c.req.json();
  if (!validText(text) || typeof accountId !== 'string') return c.json(fail('本文は1〜500文字、アカウントの選択が必要です'), 400);
  const account = await c.env.DB.prepare("SELECT id FROM threads_accounts WHERE id = ? AND status = 'connected'").bind(accountId).first();
  if (!account) return c.json(fail('接続済みのアカウントが必要です'), 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO threads_posts (id, account_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, accountId, text, now(), now()).run();
  return c.json(ok({ id }), 201);
});
// The VPS workflow produced a three-part hook/body/conclusion chain. Keep each
// part durable so a failure after publishing part one never replays that part.
app.post('/api/chains', async c => {
  const { accountId, parts } = await c.req.json();
  if (typeof accountId !== 'string' || !Array.isArray(parts) || parts.length < 2 || parts.length > 10 || !parts.every(validText)) return c.json(fail('連投は2〜10件、各本文は1〜500文字です'), 400);
  if (!await c.env.DB.prepare("SELECT id FROM threads_accounts WHERE id=? AND status='connected'").bind(accountId).first()) return c.json(fail('接続済みのアカウントが必要です'), 400);
  const chainId = crypto.randomUUID();
  const ids = parts.map(() => crypto.randomUUID());
  await c.env.DB.batch(parts.map((text, index) => c.env.DB.prepare('INSERT INTO threads_posts (id,account_id,text,chain_id,part_index,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(ids[index], accountId, text, chainId, index, index ? ids[index - 1] : null, now(), now())));
  return c.json(ok({ chainId, ids }), 201);
});
app.post('/api/posts/:id/insights', async c => {
  const post = await c.env.DB.prepare("SELECT p.published_id, a.token_cipher FROM threads_posts p JOIN threads_accounts a ON p.account_id=a.id WHERE p.id=? AND p.published_id IS NOT NULL AND a.status='connected'").bind(c.req.param('id')).first<{ published_id: string; token_cipher: string }>();
  if (!post) return c.json(fail('接続中のアカウントの公開済み記事が必要です'), 409);
  const metrics = await new ThreadsApi(await unseal(post.token_cipher, c.env.TOKEN_ENCRYPTION_KEY)).insights(post.published_id);
  await c.env.DB.prepare('UPDATE threads_posts SET views=?, likes=?, replies=?, reposts=?, quotes=?, insights_updated_at=? WHERE id=?').bind(metrics.views, metrics.likes, metrics.replies, metrics.reposts, metrics.quotes, now(), c.req.param('id')).run();
  return c.json(ok(metrics));
});
app.get('/api/insights', async c => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json(fail('accountId required'), 400);
  // Views remain nullable: unavailable metrics are not silently treated as zero.
  const data = await c.env.DB.prepare("SELECT COUNT(*) AS published, COUNT(views) AS measured, SUM(views) AS views, MAX(views) AS best_views, MAX(insights_updated_at) AS updated_at FROM threads_posts WHERE account_id=? AND published_id IS NOT NULL").bind(accountId).first();
  return c.json(ok(data));
});
app.patch('/api/posts/:id', async c => {
  const { text } = await c.req.json();
  if (!validText(text)) return c.json(fail('本文は1〜500文字です'), 400);
  const result = await c.env.DB.prepare("UPDATE threads_posts SET text = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(text, now(), c.req.param('id')).run();
  if (!result.meta.changes) return c.json(fail('編集できる下書きがありません'), 409);
  return c.json(ok({ updated: true }));
});
app.post('/api/posts/:id/archive', async c => {
  const target = await chainTarget(c.env.DB, c.req.param('id'));
  if (!target) return c.json(fail('連投の先頭から操作してください'), 409);
  const result = await c.env.DB.prepare(`UPDATE threads_posts SET status='archived', updated_at=? WHERE ${target.where} AND NOT EXISTS (SELECT 1 FROM threads_posts WHERE ${target.where} AND status NOT IN ('draft','published'))`).bind(now(), target.id, target.id).run();
  if (!result.meta.changes) return c.json(fail('処理中の原稿は非表示にできません'), 409);
  return c.json(ok({ archived: true }));
});
app.post('/api/posts/:id/queue', async c => {
  const { scheduledAt } = await c.req.json();
  if (scheduledAt !== undefined && (typeof scheduledAt !== 'string' || !Number.isFinite(Date.parse(scheduledAt)))) return c.json(fail('予約日時が不正です'), 400);
  const scheduled = scheduledAt === undefined ? now() : new Date(scheduledAt).toISOString();
  if (scheduledAt !== undefined && Date.parse(scheduled) < Date.now()) return c.json(fail('予約日時は未来を指定してください'), 400);
  const target = await chainTarget(c.env.DB, c.req.param('id'));
  if (!target) return c.json(fail('連投の先頭から操作してください'), 409);
  // Arm first: if queue write fails the harmless alarm runs with no job.
  const publisher = c.env.PUBLISHER.get(c.env.PUBLISHER.idFromName('tenant'));
  const armed = await publisher.fetch('https://publisher/arm', { method: 'POST' });
  if (!armed.ok) return c.json(fail('予約処理を起動できませんでした'), 503);
  const result = await c.env.DB.prepare(`UPDATE threads_posts SET status='queued', scheduled_at=?, updated_at=? WHERE ${target.where} AND NOT EXISTS (SELECT 1 FROM threads_posts WHERE ${target.where} AND status != 'draft')`).bind(scheduled, now(), target.id, target.id).run();
  if (!result.meta.changes) return c.json(fail('すでに公開処理中、または下書きがありません'), 409);
  return c.json(ok({ queued: true, scheduledAt: scheduled }));
});
app.post('/api/posts/:id/cancel', async c => {
  const target = await chainTarget(c.env.DB, c.req.param('id'));
  if (!target) return c.json(fail('連投の先頭から操作してください'), 409);
  const result = await c.env.DB.prepare(`UPDATE threads_posts SET status='draft', scheduled_at=NULL, updated_at=? WHERE ${target.where} AND NOT EXISTS (SELECT 1 FROM threads_posts WHERE ${target.where} AND status != 'queued')`).bind(now(), target.id, target.id).run();
  if (!result.meta.changes) return c.json(fail('処理開始後は取り消せません'), 409);
  return c.json(ok({ cancelled: true }));
});
app.get('/api/usage', async c => c.json(ok(await c.env.DB.prepare("SELECT (SELECT COUNT(*) FROM threads_accounts WHERE status='connected') AS accounts, COUNT(*) AS posts, SUM(status='published') AS published FROM threads_posts").first())));
app.notFound(c => c.req.path.startsWith('/api/') ? c.json(fail('Not found'), 404) : c.env.ASSETS.fetch(c.req.raw));

async function chainTarget(db: D1Database, id: string) {
  const post = await db.prepare('SELECT id,chain_id,part_index FROM threads_posts WHERE id=?').bind(id).first<{id: string; chain_id: string | null; part_index: number | null}>();
  if (!post || (post.chain_id && post.part_index !== 0)) return null;
  return { where: post.chain_id ? 'chain_id=?' : 'id=?', id: post.chain_id || post.id };
}

/** One scheduler per tenant, including Workers-for-Platforms (which has no cron).
 * A claimed mutation is never automatically retried after an uncertain outcome.
 */
export class ThreadsPublisher {
  constructor(private state: DurableObjectState, private env: Bindings) {}
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== '/arm' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!await this.state.storage.getAlarm()) await this.state.storage.setAlarm(Date.now() + 1000);
    return new Response('ok');
  }
  async alarm() {
    // Keep recovery armed even if a read/write fails midway.
    await this.state.storage.setAlarm(Date.now() + 60000);
    await this.env.DB.prepare("UPDATE threads_posts SET status='needs_review', error_code='interrupted', updated_at=? WHERE status IN ('creating','publishing') AND updated_at < ?")
      .bind(now(), new Date(Date.now() - 120000).toISOString()).run();
    await this.env.DB.prepare("UPDATE threads_posts SET status='needs_review', error_code='chain_parent_unconfirmed', updated_at=? WHERE status='queued' AND chain_id IN (SELECT chain_id FROM threads_posts WHERE status='needs_review' AND chain_id IS NOT NULL)").bind(now()).run();
    const due = await this.env.DB.prepare("SELECT p.* FROM threads_posts p LEFT JOIN threads_posts parent ON parent.id=p.parent_id WHERE ((p.status='queued' AND p.scheduled_at <= ?) OR p.status='processing') AND (p.parent_id IS NULL OR parent.published_id IS NOT NULL) ORDER BY p.scheduled_at, p.part_index LIMIT 5").bind(now()).all<Post>();
    for (const post of due.results) await processPost(this.env, post);
    // Keep the minute tick while work exists, avoiding lost wakeups during API queue writes.
  }
}

export async function processPost(env: Bindings, post: Post, clientFactory = (token: string) => new ThreadsApi(token)) {
  if (!['queued', 'processing'].includes(post.status)) return;
  let replyToId: string | undefined;
  if (post.parent_id) {
    const parent = await env.DB.prepare('SELECT published_id FROM threads_posts WHERE id=? AND account_id=?').bind(post.parent_id, post.account_id).first<{ published_id: string | null }>();
    if (!parent?.published_id) return;
    replyToId = parent.published_id;
  }
  const next = post.status === 'queued' ? 'creating' : 'publishing';
  const claimed = await env.DB.prepare('UPDATE threads_posts SET status=?, updated_at=? WHERE id=? AND status=?').bind(next, now(), post.id, post.status).run();
  if (!claimed.meta.changes) return;
  try {
    const account = await env.DB.prepare("SELECT token_cipher FROM threads_accounts WHERE id=? AND status='connected'").bind(post.account_id).first<{ token_cipher: string }>();
    if (!account) throw new Error('account_disconnected');
    const client = clientFactory(await unseal(account.token_cipher, env.TOKEN_ENCRYPTION_KEY));
    if (next === 'creating') {
      const container = await client.create(post.account_id, post.text, replyToId);
      await env.DB.prepare("UPDATE threads_posts SET status='processing', container_id=?, updated_at=? WHERE id=? AND status='creating'").bind(container, now(), post.id).run();
    } else {
      if (!post.container_id) throw new Error('missing_container');
      const status = await client.status(post.container_id);
      if (status === 'IN_PROGRESS') {
        await env.DB.prepare("UPDATE threads_posts SET status='processing', updated_at=? WHERE id=? AND status='publishing'").bind(now(), post.id).run();
        return;
      }
      if (status !== 'FINISHED') throw new Error('container_not_ready');
      const id = await client.publish(post.account_id, post.container_id);
      await env.DB.prepare("UPDATE threads_posts SET status='published', published_id=?, updated_at=? WHERE id=? AND status='publishing'").bind(id, now(), post.id).run();
    }
  } catch {
    await env.DB.prepare("UPDATE threads_posts SET status='needs_review', error_code='publication_unconfirmed', updated_at=? WHERE id=? AND status IN ('creating','publishing')").bind(now(), post.id).run();
  }
}
export default app;
