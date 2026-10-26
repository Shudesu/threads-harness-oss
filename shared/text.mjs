// Meta counts emoji clusters by UTF-8 bytes. Keep one implementation for the
// Worker, web console and Node MCP; ordinary text retains code-point counting.
// https://developers.facebook.com/documentation/threads/posts.md
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emoji = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u;
const encoder = new TextEncoder();
export function countThreadsText(text) {
  let length = 0;
  for (const { segment } of segmenter.segment(text)) {
    length += emoji.test(segment) ? encoder.encode(segment).length : [...segment].length;
  }
  return length;
}
export function validThreadsText(text) {
  return typeof text === 'string' && text.trim().length > 0 && countThreadsText(text) <= 500;
}
