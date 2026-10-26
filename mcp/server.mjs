import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validThreadsText } from '../shared/text.mjs';

export function readConfig(env = process.env) {
  const key = env.THREADS_HARNESS_API_KEY?.trim();
  let url;
  try { url = new URL(env.THREADS_HARNESS_API_URL); } catch { throw new Error('Set THREADS_HARNESS_API_URL to the workspace HTTPS origin.'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('THREADS_HARNESS_API_URL must be an HTTPS origin (HTTP allowed only on loopback).');
  if (!key || /[\r\n]/.test(key)) throw new Error('Set THREADS_HARNESS_API_KEY using your secret manager.');
  if (env.THREADS_HARNESS_READ_ONLY && !['true', 'false'].includes(env.THREADS_HARNESS_READ_ONLY)) throw new Error('THREADS_HARNESS_READ_ONLY must be true or false.');
  return { origin: url.origin, key, readOnly: env.THREADS_HARNESS_READ_ONLY === 'true' };
}
export function createApi(config, request = fetch) {
  return async (path, method = 'GET', body) => {
    if (config.readOnly && method !== 'GET') throw new Error('Read-only mode blocks mutations.');
    let response;
    try { response = await request(`${config.origin}/api${path}`, { method, redirect: 'error', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('Workspace request did not complete. Check saved state before retrying a mutation.'); }
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.success !== true) throw new Error(`Workspace HTTP ${response.status}${typeof json?.code === 'string' && /^[a-z0-9_]+$/.test(json.code) ? ` (${json.code})` : ''}. Check workspace diagnostics; do not blindly retry publication.`);
    return json.data;
  };
}
export function createServer(config, request = fetch) {
  const api = createApi(config, request);
  const server = new McpServer({ name: 'threads-harness', version: '0.1.2' });
  const id = z.string().min(1).max(128);
  const text = z.string().min(1).refine(s => validThreadsText(s), 'Text must fit 500 units; emoji clusters count as UTF-8 bytes.');
  const register = (name, description, schema, readOnly, action) => {
    if (config.readOnly && !readOnly) return;
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: !readOnly } }, async args => {
      try { return { content: [{ type: 'text', text: JSON.stringify(await action(args)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  };
  register('threads_accounts', 'List workspace accounts and saved connection health; does not contact Meta.', {}, true, () => api('/accounts'));
  register('threads_health', 'Check configuration readiness and aggregate account count.', {}, true, () => api('/health'));
  register('threads_posts', 'List saved drafts and publication history for an account.', { accountId: id }, true, a => api(`/posts?accountId=${encodeURIComponent(a.accountId)}`));
  register('threads_insights', 'Read saved aggregate insights, without fetching new metrics.', { accountId: id }, true, a => api(`/insights?accountId=${encodeURIComponent(a.accountId)}`));
  register('threads_create_draft', 'Save a text draft. Does not publish.', { accountId: id, text }, false, a => api('/posts', 'POST', a));
  register('threads_create_chain', 'Save 2–10 drafts as an ordered reply chain. Does not publish.', { accountId: id, parts: z.array(text).min(2).max(10) }, false, a => api('/chains', 'POST', a));
  register('threads_queue', 'Publish or schedule a saved draft/chain. Obtain explicit user approval for the exact content, account and time before setting confirmed=true. Never retry an uncertain result.', { postId: id, scheduledAt: z.iso.datetime({ offset: true }).optional(), confirmed: z.literal(true) }, false, a => api(`/posts/${encodeURIComponent(a.postId)}/queue`, 'POST', a.scheduledAt ? { scheduledAt: a.scheduledAt } : {}));
  register('threads_cancel', 'Cancel queued work before processing starts.', { postId: id }, false, a => api(`/posts/${encodeURIComponent(a.postId)}/cancel`, 'POST', {}));
  register('threads_fetch_insights', 'Fetch Meta insights and update saved metrics for a published post.', { postId: id }, false, a => api(`/posts/${encodeURIComponent(a.postId)}/insights`, 'POST', {}));
  register('threads_resume_queue', 'Resume queued work after reconnecting. Obtain explicit approval for all retained pending posts; this can publish overdue drafts immediately.', { accountId: id, confirmed: z.literal(true) }, false, a => api(`/accounts/${encodeURIComponent(a.accountId)}/resume`, 'POST', { confirmed: true }));
  register('threads_publishing_limits', 'Read live Meta publishing/reply quotas. Reply quota requires threads_manage_replies.', { accountId: id, includeReplies: z.boolean().optional() }, true, a => api(`/accounts/${encodeURIComponent(a.accountId)}/limits${a.includeReplies ? '?replies=1' : ''}`));
  register('threads_check_connection', 'Recheck saved token permissions/expiry through Meta and save health. Does not publish.', { accountId: id }, false, a => api(`/accounts/${encodeURIComponent(a.accountId)}/check`, 'POST', {}));
  return { server, verify: () => api('/accounts') };
}
