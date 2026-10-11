import { Hono } from 'hono';
import type { Bindings } from './index';
import { verifyAdminSsoToken, ADMIN_SSO_MIN_SECRET_LENGTH } from './admin-sso-token';

/** The same one-use token contract as the Cloud control plane. */
export const adminSso = new Hono<{ Bindings: Bindings }>();
adminSso.get('/admin/sso', async c => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  if (c.req.method !== 'GET') return c.body(null, 200);
  const denied = () => c.html('<html lang="ja"><meta charset="utf-8"><p>リンクが無効です。管理ポータルから開き直してください。</p></html>', 403);
  const secret = c.env.ADMIN_SSO_SECRET ?? '';
  const token = c.req.query('token') ?? '';
  if (secret.length < ADMIN_SSO_MIN_SECRET_LENGTH || !c.env.API_KEY || token.length > 4096) return denied();
  const result = await verifyAdminSsoToken(secret, token, Math.floor(Date.now() / 1000));
  if (!result.ok) return denied();
  try {
    await c.env.DB.prepare("INSERT INTO admin_sso_jti (jti, seen_at) VALUES (?, datetime('now'))").bind(result.payload.jti).run();
  } catch { return denied(); }
  c.executionCtx.waitUntil(c.env.DB.prepare("DELETE FROM admin_sso_jti WHERE seen_at < datetime('now','-1 day')").run().catch(() => undefined));
  const literal = JSON.stringify(c.env.API_KEY).replaceAll('<', '\\u003c');
  const nonce = crypto.randomUUID();
  c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  return c.html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>Threads Harness</title><p>管理画面に移動します。</p><script nonce="${nonce}">sessionStorage.setItem('threads_api_key',${literal});location.replace('/');</script></html>`);
});
