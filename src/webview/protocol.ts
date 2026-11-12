import { AppError } from '../domain/errors';
import { Cell, PageRequest, Row } from '../domain/database';
import { isCell } from '../domain/editSession';
export type Message = { type: 'ready' | 'refresh' | 'undo' | 'redo' | 'discard' | 'save' } | { type: 'edit'; row: number; column: string; value: Cell } | { type: 'editRow'; row: number; values: Row } | { type: 'page'; request: PageRequest } | { type: 'query'; sql: string } | { type: 'export'; format: 'csv' | 'json' };
/** The Webview is an untrusted boundary. Never cast inbound messages directly. */
export function parseMessage(value: unknown): Message {
  if (!value || typeof value !== 'object') { throw new AppError('invalidMessage'); }
  const m = value as Record<string, unknown>;
  if (m.type === 'ready' || m.type === 'refresh' || m.type === 'undo' || m.type === 'redo' || m.type === 'discard' || m.type === 'save') { return { type: m.type }; }
  if (m.type === 'edit' && Number.isInteger(m.row) && (m.row as number) >= 0 && (m.row as number) < 100 && typeof m.column === 'string' && m.column.length <= 4096 && isCell(m.value)) { return { type: 'edit', row: m.row as number, column: m.column, value: m.value }; }
  if (m.type === 'editRow' && Number.isInteger(m.row) && (m.row as number) >= 0 && (m.row as number) < 100 && m.values && typeof m.values === 'object' && !Array.isArray(m.values)) {
    const entries = Object.entries(m.values);
    if (entries.length > 0 && entries.length <= 1000 && entries.every(([column, cell]) => column.length <= 4096 && isCell(cell)) && JSON.stringify(m.values).length <= 8 * 1024 * 1024) {
      return { type: 'editRow', row: m.row as number, values: Object.fromEntries(entries) as Row };
    }
  }
  if (m.type === 'query' && typeof m.sql === 'string' && m.sql.length <= 100_000) { return { type: 'query', sql: m.sql }; }
  if (m.type === 'export' && (m.format === 'csv' || m.format === 'json')) { return { type: 'export', format: m.format }; }
  if (m.type === 'page' && m.request && typeof m.request === 'object') {
    const r = m.request as Record<string, unknown>;
    if (typeof r.table === 'string' && r.table.length <= 4096 && typeof r.page === 'number' && Number.isSafeInteger(r.page) && r.page >= 0 && r.page <= 1_000_000 && typeof r.filter === 'string' && r.filter.length <= 1000 && typeof r.descending === 'boolean' && (r.sort === undefined || typeof r.sort === 'string')) {
      return { type: 'page', request: { table: r.table, page: r.page, filter: r.filter, descending: r.descending, sort: r.sort as string | undefined } };
    }
  }
  throw new AppError('invalidMessage');
}
