import { AppError } from './errors';
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type CellType = 'text' | 'number' | 'null' | 'blob';
export interface RowSnapshot { fingerprint: string; types: Record<string, CellType>; safe: boolean }
export interface EditingInfo { table: string; primaryKeys: string[]; columns: string[]; schemaSql: string }
export interface Result { columns: string[]; rows: Row[]; truncated: boolean; snapshots?: RowSnapshot[]; editing?: EditingInfo }
export interface SchemaObject { name: string; type: 'table' | 'view' | 'index'; tbl_name: string; sql: string | null }
export interface Column { name: string; type: string; pk: number; notnull: number; hidden?: number }
export interface RowChange { table: string; schemaSql: string; primaryKeys: string[]; key: Cell[]; fingerprint: string; values: Row }
export interface WriteResult { backupPath: string; rows: { row: Row; snapshot: RowSnapshot }[] }
export interface DatabaseWriter { save(changes: RowChange[]): Promise<WriteResult> }

/** Port used by application services. No dependency on VS Code or the SQLite driver. */
export interface Database {
  query(sql: string, parameters?: readonly unknown[], limit?: number): Promise<Result>;
  close(): Promise<void>;
}
export interface PageRequest { table: string; page: number; filter: string; sort?: string; descending: boolean }
export const PAGE_SIZE = 100;
export const QUERY_LIMIT = 1000;

export function quoteIdentifier(value: string): string {
  if (value.includes('\0')) { throw new AppError('invalidIdentifier'); }
  return `"${value.replace(/"/g, '""')}"`;
}
