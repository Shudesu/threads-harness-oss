import { describe, expect, it } from 'vitest';
// @ts-expect-error The release helper is a Node ESM script.
import { parseConfig } from '../scripts/release/config.mjs';
describe('JSONC release configuration', () => {
  it('preserves URLs while accepting comments and trailing commas', () => {
    expect(parseConfig('{ // comment\n "url": "https://example.com/a//b", /* block */ "enabled": true, }')).toEqual({ url: 'https://example.com/a//b', enabled: true });
  });
  it('reports syntax errors without echoing configuration contents', () => {
    expect(() => parseConfig('{"secret": "do-not-echo", broken}')).toThrow(/Invalid wrangler.jsonc:/);
    try { parseConfig('{"secret": "do-not-echo", broken}'); } catch (e) { expect(String(e)).not.toContain('do-not-echo'); }
  });
});
