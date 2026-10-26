import { describe, expect, it } from 'vitest';
import { countThreadsText, validThreadsText } from '../shared/text.mjs';
describe('Meta text budgeting', () => {
  it.each([['Hello 日本語', 9], ['😀', 4], ['👍🏽', 8], ['👨‍👩‍👧‍👦', 25], ['🇯🇵', 8], ['1️⃣', 7], ['©️', 5], ['123#*', 5], ['漢字\nかな', 5]])('counts %s as %i', (value, count) => {
    expect(countThreadsText(value)).toBe(count);
  });
  it('keeps Japanese at one unit and rejects emoji overflow at the same boundary', () => {
    expect(validThreadsText('あ'.repeat(500))).toBe(true);
    expect(validThreadsText('😀'.repeat(125))).toBe(true);
    expect(validThreadsText('😀'.repeat(126))).toBe(false);
    expect(validThreadsText('a'.repeat(476) + '👨‍👩‍👧‍👦')).toBe(false);
  });
});
