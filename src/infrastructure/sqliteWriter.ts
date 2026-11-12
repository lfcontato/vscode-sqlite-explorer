import sqlite3 from 'sqlite3';
import { randomBytes } from 'node:crypto';
import { AppError } from '../domain/errors';
import { Column, DatabaseWriter, RowChange, WriteResult, quoteIdentifier } from '../domain/database';
import { snapshotRow } from './rowSnapshot';

/** Dedicated write adapter. SQL supplied by the query editor never reaches this connection. */
export class SqliteWriter implements DatabaseWriter {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  save(changes: RowChange[]): Promise<WriteResult> {
    const next = this.queue.then(() => this.persist(changes));
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async persist(changes: RowChange[]): Promise<WriteResult> {
    if (!changes.length || changes.length > 100) { throw new AppError('invalidEdit'); }
    const db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const handle = new sqlite3.Database(this.file, sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve(handle));
    });
    db.configure('busyTimeout', 3000);
    const run = (sql: string, params: unknown[] = []): Promise<number> => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve(this.changes); }));
    const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> => new Promise((resolve, reject) => db.all<T>(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    const backupPath = `${this.file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.sqlite`;
    const timer = setTimeout(() => db.interrupt(), 30_000);
    let transaction = false;
    try {
      await run('PRAGMA trusted_schema = OFF');
      await run('PRAGMA foreign_keys = ON');
      // VACUUM INTO creates a consistent SQLite snapshot, including committed WAL contents.
      await run('VACUUM INTO ?', [backupPath]);
      await run('BEGIN IMMEDIATE'); transaction = true;
      const predicates: { sql: string; params: unknown[] }[] = [];
      for (const change of changes) {
        const schema = await all<{ type: string; sql: string }>('SELECT type, sql FROM sqlite_schema WHERE name = ?', [change.table]);
        if (schema.length !== 1 || schema[0]?.type !== 'table' || schema[0].sql !== change.schemaSql) { throw new AppError('editConflict'); }
        const columns = await all<Column>('SELECT name, type, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid', [change.table]);
        const keys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
        if (!keys.length || JSON.stringify(keys) !== JSON.stringify(change.primaryKeys) || keys.length !== change.key.length || change.key.some(value => value === null)) { throw new AppError('invalidEdit'); }
        const names = Object.keys(change.values);
        if (!names.length || names.some(name => !columns.some(column => column.name === name && !column.pk && !column.hidden && !/BLOB/i.test(column.type)))) { throw new AppError('invalidEdit'); }
        const predicate = { sql: keys.map(key => `${quoteIdentifier(key)} IS ? COLLATE BINARY`).join(' AND '), params: [...change.key] };
        const current = await all<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(change.table)} WHERE ${predicate.sql} LIMIT 2`, predicate.params);
        if (current.length !== 1) { throw new AppError('editConflict'); }
        const snapshot = snapshotRow(current[0]!).snapshot;
        if (!snapshot.safe || snapshot.fingerprint !== change.fingerprint) { throw new AppError('editConflict'); }
        if (names.some(name => snapshot.types[name] === 'blob')) { throw new AppError('invalidEdit'); }
        const values = names.map(name => change.values[name]);
        if (values.some(value => value === undefined || (typeof value !== 'string' && typeof value !== 'number' && value !== null) || (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))))) { throw new AppError('invalidEdit'); }
        const count = await run(`UPDATE ${quoteIdentifier(change.table)} SET ${names.map(name => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${predicate.sql}`, [...values, ...predicate.params]);
        if (count !== 1) { throw new AppError('editConflict'); }
        predicates.push(predicate);
      }
      const rows: WriteResult['rows'] = [];
      // Read again after all triggers have run, before committing.
      for (let i = 0; i < changes.length; i++) {
        const predicate = predicates[i]!;
        const current = await all<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(changes[i]!.table)} WHERE ${predicate.sql} LIMIT 2`, predicate.params);
        if (current.length !== 1) { throw new AppError('editConflict'); }
        const saved = snapshotRow(current[0]!);
        if (!saved.snapshot.safe) { throw new AppError('invalidEdit'); }
        rows.push(saved);
      }
      await run('COMMIT'); transaction = false;
      return { backupPath, rows };
    } catch (error) {
      if (transaction) { await run('ROLLBACK'); }
      throw error;
    } finally {
      clearTimeout(timer);
      await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    }
  }
}
