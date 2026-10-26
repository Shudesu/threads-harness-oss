export const REQUIRED_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'] as const;

// Only numeric Meta diagnostics cross the API/storage boundary. Never retain
// messages, URLs or bodies: they can contain credentials and user content.
export type ErrorKind = 'token_invalid' | 'permission_denied' | 'rate_limited' | 'action_blocked' | 'container_error' | 'unknown';
export function errorKind(code?: number, subcode?: number, status?: number): ErrorKind {
  if (code === 190 || status === 401) return 'token_invalid';
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return 'permission_denied';
  if (status === 429 || [4, 17, 32, 341, 613].includes(code ?? -1)) return 'rate_limited';
  if (code === 368 || (code === 1 && subcode === 2207051)) return 'action_blocked';
  if (code === 24) return 'container_error';
  return 'unknown';
}
export class ThreadsError extends Error {
  readonly kind: ErrorKind;
  constructor(public code: string, message: string, public status: 400 | 409 | 422 | 502 | 503 = 502,
    public metaCode?: number, public metaSubcode?: number, public upstreamStatus?: number) {
    super(message);
    this.kind = code === 'token_expired' ? 'token_invalid' : code === 'missing_permissions' ? 'permission_denied' : code === 'quota_exhausted' ? 'rate_limited' : code.startsWith('container_') ? 'container_error' : errorKind(metaCode, metaSubcode, upstreamStatus);
  }
}
const numeric = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function upstreamError(status: number, value: unknown) {
  const error = value && typeof value === 'object' ? (value as Record<string, any>).error : undefined;
  const code = numeric(error?.code), subcode = numeric(error?.error_subcode);
  const kind = errorKind(code, subcode, status);
  const messages = { token_invalid: 'Threadsトークンが無効または失効しています。再発行して接続し直してください。', permission_denied: 'Threadsの権限を確認し、必要な権限でトークンを再発行してください。', rate_limited: 'Threadsの利用制限に達しました。時間を置いて確認してください。', action_blocked: 'Metaが操作を制限しています。アカウントの状態を確認してください。', container_error: 'Threadsのコンテナ状態を確認できませんでした。公開結果を確認してください。', unknown: 'Threads APIでエラーが発生しました。' };
  const message = code === 452 ? 'トークンの種類とThreads App Secretを確認してください。長期トークンの再交換は不要です。' : messages[kind];
  const diagnostic = code === undefined ? `HTTP ${status}` : `Meta ${code}${subcode === undefined ? '' : ` / ${subcode}`}`;
  return new ThreadsError(code === undefined ? `threads_http_${status}` : `threads_meta_${code}${subcode === undefined ? '' : `_${subcode}`}`, `${message}（${diagnostic}）`, kind === 'token_invalid' ? 422 : 502, code, subcode, status);
}
export interface Quota { used: number; total: number; remaining: number; duration: number }
export interface PublishingLimits { posts: Quota; replies?: Quota; checkedAt: string }
function parseQuota(used: unknown, config: any): Quota {
  if (numeric(used) === undefined || numeric(config?.quota_total) === undefined || !Number.isSafeInteger(config?.quota_duration) || config.quota_duration <= 0) throw new ThreadsError('quota_unavailable', 'Threadsの公開枠を確認できませんでした。');
  return { used: used as number, total: config.quota_total, remaining: Math.max(0, config.quota_total - (used as number)), duration: config.quota_duration };
}
const CONTAINER_ERRORS = new Set(['FAILED_DOWNLOADING_VIDEO', 'FAILED_PROCESSING_AUDIO', 'FAILED_PROCESSING_VIDEO', 'INVALID_ASPEC_RATIO', 'INVALID_BIT_RATE', 'INVALID_DURATION', 'INVALID_FRAME_RATE', 'INVALID_AUDIO_CHANNELS', 'INVALID_AUDIO_CHANNEL_LAYOUT', 'UNKNOWN']);
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
  async publishingLimits(user: string, includeReplies = false): Promise<PublishingLimits> {
    const fields = includeReplies ? 'quota_usage,config,reply_quota_usage,reply_config' : 'quota_usage,config';
    const result = await this.call(`${encodeURIComponent(user)}/threads_publishing_limit?fields=${fields}`);
    const data = Array.isArray(result.data) ? result.data[0] : null;
    return { posts: parseQuota(data?.quota_usage, data?.config), ...(includeReplies ? { replies: parseQuota(data?.reply_quota_usage, data?.reply_config) } : {}), checkedAt: new Date().toISOString() };
  }
  async create(user: string, text: string, replyToId?: string) {
    const result = await this.call(`${encodeURIComponent(user)}/threads`, { media_type: 'TEXT', text, ...(replyToId ? { reply_to_id: replyToId } : {}) });
    if (typeof result.id !== 'string') throw new Error('missing_container');
    return result.id;
  }
  async insights(postId: string): Promise<Record<string, number | null>> {
    const result = await this.call(`${encodeURIComponent(postId)}/insights?metric=views,likes,replies,reposts,quotes,shares`);
    if (!Array.isArray(result.data)) throw new Error('invalid_insights');
    const metrics: Record<string, number | null> = { views: null, likes: null, replies: null, reposts: null, quotes: null, shares: null };
    for (const metric of result.data) {
      const value = metric?.values?.[0]?.value;
      if (Object.hasOwn(metrics, metric?.name) && Number.isSafeInteger(value) && value >= 0) metrics[metric.name] = value;
    }
    return metrics;
  }
  async status(container: string) {
    const value = await this.call(`${encodeURIComponent(container)}?fields=status,error_message`);
    return { status: typeof value.status === 'string' ? value.status : 'UNKNOWN', error_message: typeof value.error_message === 'string' && CONTAINER_ERRORS.has(value.error_message) ? value.error_message : null };
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
