import { countThreadsText, validThreadsText } from './text.mjs';

// URLs are passed to Meta, never fetched by the Worker or previewed automatically.
export function validMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim()) return false;
  try {
    const u = new URL(value), host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') &&
      host.includes('.') && !host.includes(':') && !/^\d+(\.\d+){3}$/.test(host) &&
      !['localhost', 'local', 'internal', 'test', 'invalid'].some(s => host === s || host.endsWith('.' + s));
  } catch { return false; }
}
export function validMedia(media) {
  return Array.isArray(media) && media.length <= 20 && media.every(m => m && typeof m === 'object' &&
    ['IMAGE', 'VIDEO'].includes(m.type) && validMediaUrl(m.url) &&
    Object.keys(m).every(k => ['type', 'url'].includes(k)));
}
export function validDraftContent(text, media = []) {
  return validMedia(media) && typeof text === 'string' &&
    (media.length ? countThreadsText(text) <= 500 : validThreadsText(text));
}
