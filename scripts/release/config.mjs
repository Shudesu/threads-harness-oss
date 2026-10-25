import { parse, printParseErrorCode } from 'jsonc-parser';
export function parseConfig(source) {
  const errors = [];
  const value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid wrangler.jsonc: ${errors.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(', ')}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('wrangler.jsonc must contain an object');
  return value;
}
