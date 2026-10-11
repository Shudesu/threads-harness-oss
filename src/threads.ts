// Contract: Meta's official sample https://github.com/fbsamples/threads_api
// Use a fixed upstream; never log tokens, upstream bodies or request URLs.
export class ThreadsApi {
  constructor(private token: string, private request: typeof fetch = fetch) {}
  async call(path: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(`https://graph.threads.net/v1.0/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`threads_http_${response.status}`);
    const value = await response.json() as Record<string, unknown>;
    if (value.error) throw new Error('threads_api_error');
    return value;
  }
  async profile() {
    const value = await this.call('me?fields=id,username');
    if (typeof value.id !== 'string' || !/^\d+$/.test(value.id) || typeof value.username !== 'string') throw new Error('invalid_profile');
    return { id: value.id, username: value.username };
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
  const key = await crypto.subtle.importKey('raw', bytes(keyBase64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  return btoa(String.fromCharCode(...iv, ...encrypted));
}
export async function unseal(cipher: string, keyBase64: string) {
  const raw = bytes(cipher);
  const key = await crypto.subtle.importKey('raw', bytes(keyBase64), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}
