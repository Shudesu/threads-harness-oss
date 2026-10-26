export const REQUIRED_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'] as const;

// Only numeric Meta diagnostics cross the API/storage boundary. Never retain
// messages, URLs or bodies: they can contain credentials and user content.
export class ThreadsError extends Error {
  constructor(public code: string, message: string, public status: 400 | 409 | 422 | 502 | 503 = 502,
    public metaCode?: number, public metaSubcode?: number, public upstreamStatus?: number) { super(message); }
}
const numeric = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function upstreamError(status: number, value: unknown) {
  const error = value && typeof value === 'object' ? (value as Record<string, any>).error : undefined;
  const code = numeric(error?.code), subcode = numeric(error?.error_subcode);
  const kind = code === 190 ? 'invalid_token' : code === 10 || code === 200 ? 'permission_denied' : status === 429 || [4, 17, 32, 613].includes(code ?? -1) ? 'rate_limited' : 'upstream_error';
  const messages = { invalid_token: 'Threadsトークンが無効または失効しています。再発行して接続し直してください。', permission_denied: 'Threadsの権限を確認し、必要な権限でトークンを再発行してください。', rate_limited: 'Threadsの利用制限に達しました。時間を置いて確認してください。', upstream_error: 'Threads APIでエラーが発生しました。' };
  const diagnostic = code === undefined ? `HTTP ${status}` : `Meta ${code}${subcode === undefined ? '' : ` / ${subcode}`}`;
  return new ThreadsError(code === undefined ? `threads_http_${status}` : `threads_meta_${code}${subcode === undefined ? '' : `_${subcode}`}`, `${messages[kind]}（${diagnostic}）`, code === 190 ? 422 : 502, code, subcode, status);
}
export function validateEncryptionKey(keyBase64: string) {
  try {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(keyBase64) || atob(keyBase64).length !== 32) throw new Error();
  } catch { throw new ThreadsError('encryption_key_invalid', 'TOKEN_ENCRYPTION_KEYを32バイトのbase64で設定してください。既存の鍵を確認し、安易に再生成しないでください。', 503); }
}
const expiration = (value: unknown): string | null => {
  if (value === undefined || value === null || value === 0) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 253402300799) throw new ThreadsError('invalid_token_metadata', 'Threadsの期限情報を確認できませんでした。');
  return new Date(value * 1000).toISOString();
};

// Contract: Meta's official sample https://github.com/fbsamples/threads_api
// Use a fixed upstream; never log tokens, upstream bodies or request URLs.
export class ThreadsApi {
  constructor(private token: string, private request: typeof fetch = (input, init) => fetch(input, init)) {}
  async call(path: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(`https://graph.threads.net/v1.0/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const value = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || value?.error) throw upstreamError(response.status, value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ThreadsError('invalid_response', 'Threadsの応答を確認できませんでした。');
    return value;
  }
  async profile() {
    const value = await this.call('me?fields=id,username');
    if (typeof value.id !== 'string' || !/^\d+$/.test(value.id) || typeof value.username !== 'string') throw new Error('invalid_profile');
    return { id: value.id, username: value.username };
  }
  async inspect(appAccessToken?: string) {
    // Self-inspection is supported for Threads testers. Other users require an
    // app token supplied by the operator, never by the browser connection form.
    let result: Record<string, unknown>;
    try {
      result = await new ThreadsApi(appAccessToken || this.token, this.request).call(`debug_token?input_token=${encodeURIComponent(this.token)}`);
    } catch (error) {
      if (error instanceof ThreadsError) throw new ThreadsError('token_inspection_failed', `権限と期限を診断できません。Threadsテスターの承認、または同じアプリのTHREADS_APP_ACCESS_TOKEN設定を確認してください。（${error.code}）`, 502);
      throw error;
    }
    const data = result.data as Record<string, unknown> | undefined;
    if (!data || data.is_valid !== true) throw upstreamError(400, { error: { code: 190 } });
    if (data.type !== 'USER' || typeof data.user_id !== 'string' || !Array.isArray(data.scopes) || !data.scopes.every(scope => typeof scope === 'string')) {
      throw new ThreadsError('invalid_token_metadata', 'Threadsユーザートークンの権限情報を確認できませんでした。', 422);
    }
    const missing = REQUIRED_SCOPES.filter(scope => !(data.scopes as string[]).includes(scope));
    if (missing.length) throw new ThreadsError('missing_permissions', `不足している権限: ${missing.join(', ')}。権限を追加してトークンを再発行してください。`, 422);
    const tokenExpiresAt = expiration(data.expires_at), dataAccessExpiresAt = expiration(data.data_access_expires_at);
    if ([tokenExpiresAt, dataAccessExpiresAt].some(date => date && Date.parse(date) <= Date.now())) throw upstreamError(400, { error: { code: 190 } });
    return { userId: data.user_id, tokenExpiresAt, dataAccessExpiresAt };
  }
  async create(user: string, text: string, replyToId?: string) {
    const result = await this.call(`${encodeURIComponent(user)}/threads`, { media_type: 'TEXT', text, ...(replyToId ? { reply_to_id: replyToId } : {}) });
    if (typeof result.id !== 'string') throw new Error('missing_container');
    return result.id;
  }
  async insights(postId: string): Promise<Record<string, number | null>> {
    const result = await this.call(`${encodeURIComponent(postId)}/insights?metric=views,likes,replies,reposts,quotes`);
    if (!Array.isArray(result.data)) throw new Error('invalid_insights');
    const metrics: Record<string, number | null> = { views: null, likes: null, replies: null, reposts: null, quotes: null };
    for (const metric of result.data) {
      const value = metric?.values?.[0]?.value;
      if (Object.hasOwn(metrics, metric?.name) && Number.isSafeInteger(value) && value >= 0) metrics[metric.name] = value;
    }
    return metrics;
  }
  async status(container: string) {
    const value = await this.call(`${encodeURIComponent(container)}?fields=status,error_message`);
    return value.status;
  }
  async publish(user: string, container: string) {
    const result = await this.call(`${encodeURIComponent(user)}/threads_publish`, { creation_id: container });
    if (typeof result.id !== 'string') throw new Error('missing_published_id');
    return result.id;
  }
}

const bytes = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export async function seal(token: string, keyBase64: string) {
  validateEncryptionKey(keyBase64);
  const key = await crypto.subtle.importKey('raw', bytes(keyBase64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  return btoa(String.fromCharCode(...iv, ...encrypted));
}
export async function unseal(cipher: string, keyBase64: string) {
  const raw = bytes(cipher);
  validateEncryptionKey(keyBase64);
  const key = await crypto.subtle.importKey('raw', bytes(keyBase64), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}
