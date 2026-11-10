// Splits a migration file into statements for local D1 fixtures. Keeps
// CREATE TRIGGER ... BEGIN ...; END; bodies intact (a plain split on ';' breaks them).
export function sqlStatements(sql) {
  const statements = [];
  let buffer = '';
  for (const chunk of sql.replace(/^\s*--[^\n]*/gm, '').split(';')) {
    buffer += (buffer ? ';' : '') + chunk;
    if (/\bCREATE\s+TRIGGER\b/i.test(buffer) && !/\bEND\s*$/i.test(buffer.trim())) continue;
    if (buffer.trim()) statements.push(buffer.trim());
    buffer = '';
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}
