import { Result } from '../domain/database';

export function exportResult(result: Result, format: 'csv' | 'json'): string {
  if (format === 'json') { return JSON.stringify(result.rows, null, 2); }
  const cell = (value: unknown): string => {
    // Prevent spreadsheet formula execution when opening exported files.
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) { text = `'${text}`; }
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [result.columns.map(cell).join(','), ...result.rows.map(row => result.columns.map(column => cell(row[column])).join(','))].join('\r\n');
}
