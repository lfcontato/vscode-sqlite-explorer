import { AppError } from '../domain/errors';
import sqlite3 from 'sqlite3';
import { Database, Result, Row, RowSnapshot, QUERY_LIMIT } from '../domain/database';
import { snapshotRow } from './rowSnapshot';

/** Adapter: native read-only handle + query_only enforce policy even for WITH ... DELETE. */
export class SqliteDatabase implements Database {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(private readonly handle: sqlite3.Database) {}

  static async open(path: string): Promise<SqliteDatabase> {
    const handle = await new Promise<sqlite3.Database>((resolve, reject) => {
      const db = new sqlite3.Database(path, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(db));
    });
    handle.configure('busyTimeout', 3000);
    const adapter = new SqliteDatabase(handle);
    try {
      await new Promise<void>((resolve, reject) => handle.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;', error => error ? reject(error) : resolve()));
      await adapter.query('SELECT name FROM sqlite_schema LIMIT 1');
      return adapter;
    } catch (error) { await adapter.close(); throw error; }
  }

  query(sql: string, parameters: readonly unknown[] = [], limit = QUERY_LIMIT): Promise<Result> {
    if (!Number.isInteger(limit) || limit < 1 || limit > QUERY_LIMIT) { return Promise.reject(new AppError('invalidLimit')); }
    if (this.closed) { return Promise.reject(new AppError('connectionClosed')); }
    return this.enqueue(() => this.read(sql, parameters, limit));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(sql: string, parameters: readonly unknown[], limit: number): Promise<Result> {
    const timer = setTimeout(() => this.handle.interrupt(), 10_000);
    let statement: sqlite3.Statement | undefined;
    try {
      statement = await new Promise<sqlite3.Statement>((resolve, reject) => {
        const prepared = this.handle.prepare(sql, [...parameters], error => error ? reject(error) : resolve(prepared));
      });
      const rows: Row[] = [];
      const snapshots: RowSnapshot[] = [];
      let bytes = 0;
      for (let i = 0; i <= limit; i++) {
        const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
          statement!.get((error: Error | null, record: Record<string, unknown> | undefined) => error ? reject(error) : resolve(record));
        });
        if (!row) { return { columns: Object.keys(rows[0] ?? {}), rows, snapshots, truncated: false }; }
        if (i === limit) { return { columns: Object.keys(rows[0] ?? {}), rows, snapshots, truncated: true }; }
        const { row: normalized, snapshot } = snapshotRow(row);
        bytes += Buffer.byteLength(JSON.stringify(normalized));
        if (bytes > 8 * 1024 * 1024) { throw new AppError('resultTooLarge'); }
        rows.push(normalized);
        snapshots.push(snapshot);
      }
      throw new AppError('unexpectedRead');
    } finally {
      clearTimeout(timer);
      if (statement) { await new Promise<void>((resolve, reject) => statement!.finalize(error => error ? reject(error) : resolve())); }
    }
  }

  close(): Promise<void> {
    if (this.closed) { return this.queue.then(() => undefined); }
    this.closed = true;
    return this.enqueue(() => new Promise<void>((resolve, reject) => this.handle.close(error => error ? reject(error) : resolve())));
  }
}
