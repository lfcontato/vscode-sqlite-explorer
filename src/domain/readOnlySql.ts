import { AppError } from './errors';
/** Tokenizes enough SQLite syntax to reject stacked statements, without parsing SQL. */
export function validateReadOnlySql(sql: string): void {
  if (sql.length > 100_000) { throw new AppError('queryTooLong'); }
  let sanitized = '';
  let ended = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (/\s/.test(c)) { sanitized += ' '; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') { i++; }
      sanitized += ' '; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) { throw new AppError('unclosedComment'); }
      i = end + 1; sanitized += ' '; continue;
    }
    if (ended) { throw new AppError('singleStatement'); }
    if (c === ';') { ended = true; continue; }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const closing = c === '[' ? ']' : c;
      let closed = false;
      for (i++; i < sql.length; i++) {
        if (sql[i] === closing) {
          if (closing !== ']' && sql[i + 1] === closing) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) { throw new AppError('unclosedText'); }
      sanitized += ' value '; continue;
    }
    sanitized += c;
  }
  if (!/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(sanitized)) {
    throw new AppError('readOnlyQuery');
  }
}
