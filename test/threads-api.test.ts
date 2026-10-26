import { expect, it } from 'vitest';
import { ThreadsApi, upstreamError } from '../src/threads';
it.each([
  [190, 463, 400, 'token_invalid'], [undefined, undefined, 401, 'token_invalid'],
  [10, undefined, 400, 'permission_denied'], [212, undefined, 400, 'permission_denied'],
  [341, undefined, 400, 'rate_limited'], [undefined, undefined, 429, 'rate_limited'],
  [368, undefined, 400, 'action_blocked'], [1, 2207051, 400, 'action_blocked'],
  [24, 4279009, 400, 'container_error'], [452, 4279019, 400, 'unknown'],
] as const)('classifies Meta %s/%s HTTP %s without retaining upstream text', (code, subcode, http, kind) => {
  const error = upstreamError(http, { error: { code, error_subcode: subcode, message: 'private-token-in-upstream-body' } });
  expect(error.kind).toBe(kind);
  expect(JSON.stringify(error)).not.toContain('private-token');
  expect(error.message).not.toContain('private-token');
});
it('does not invent quota numbers when Meta omits requested fields', async () => {
  const api = new ThreadsApi('private-token', async () => Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250, quota_duration: 86400 } }] }));
  await expect(api.publishingLimits('123', true)).rejects.toMatchObject({ code: 'quota_unavailable' });
});
it('preserves a documented terminal error enum without exposing arbitrary provider messages', async () => {
  const api = new ThreadsApi('private-token', async () => Response.json({ status: 'ERROR', error_message: 'INVALID_ASPEC_RATIO' }));
  expect(await api.status('container')).toEqual({ status: 'ERROR', error_message: 'INVALID_ASPEC_RATIO' });
});
