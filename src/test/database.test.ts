import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { SqliteDatabase } from '../infrastructure/sqliteDatabase';
import { DatabaseService } from '../application/databaseService';
import { ConnectionManager } from '../application/connectionManager';
import { validateReadOnlySql } from '../domain/readOnlySql';
import { exportResult } from '../application/exportResult';
import { parseMessage } from '../webview/protocol';

async function fixture(): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sqlite-explorer-'));
  const file = path.join(directory, 'test.sqlite');
  const writer = await new Promise<sqlite3.Database>((resolve, reject) => {
    const db = new sqlite3.Database(file, error => error ? reject(error) : resolve(db));
  });
  await new Promise<void>((resolve, reject) => writer.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, nullable TEXT, payload BLOB);
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<205)
    INSERT INTO users SELECT n, 'User ' || n, NULL, X'00FF' FROM numbers;
    INSERT INTO users VALUES (206, '<script>alert(1)</script> 100%_test', NULL, X'00');
    CREATE VIEW names AS SELECT id, name FROM users;
    CREATE INDEX users_name ON users(name);
    CREATE TABLE "odd""table" ("weird""column" TEXT);
    INSERT INTO "odd""table" VALUES ('quoted');
  `, error => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => writer.close(error => error ? reject(error) : resolve()));
  return { directory, file };
}

test('real SQLite: schema, pagination, filters, identifiers and read-only protection', async t => {
  const { directory, file } = await fixture();
  const before = await readFile(file);
  const service = new DatabaseService(await SqliteDatabase.open(file));
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const schema = await service.schema();
  assert.ok(schema.some(item => item.name === 'names' && item.type === 'view'));
  assert.ok(schema.some(item => item.name === 'users_name' && item.type === 'index'));
  const request = { table: 'users', page: 0, filter: '', descending: false };
  const first = await service.page(request);
  assert.equal(first.rows.length, 100);
  assert.equal(first.rows[0]?.id, 1);
  assert.equal(first.truncated, true);
  assert.equal(first.rows[0]?.nullable, null);
  assert.match(String(first.rows[0]?.payload), /^BLOB/);
  const second = await service.page({ ...request, page: 1 });
  assert.equal(second.rows[0]?.id, 101);
  assert.equal(second.truncated, true);
  const last = await service.page({ ...request, page: 2 });
  assert.equal(last.rows.length, 6);
  assert.equal(last.truncated, false);
  const exactPage = await service.execute('SELECT * FROM users WHERE id <= 100');
  assert.equal(exactPage.truncated, false);
  assert.equal((await service.page({ ...request, filter: '%_' })).rows.length, 1);
  assert.equal((await service.page({ ...request, filter: "' OR 1=1 --" })).rows.length, 0);
  assert.equal((await service.page({ ...request, sort: 'id', descending: true })).rows[0]?.id, 206);
  assert.equal((await service.page({ ...request, table: 'odd"table' })).rows[0]?.['weird"column'], 'quoted');
  await assert.rejects(service.page({ ...request, sort: 'id; DROP TABLE users' }), { code: 'invalidSort' });
  await assert.rejects(service.page({ ...request, page: -1 }), { code: 'invalidPage' });
  await assert.rejects(service.execute('DELETE FROM users'), { code: 'readOnlyQuery' });
  await assert.rejects(service.execute('WITH x AS (SELECT 1) DELETE FROM users'), /readonly/);
  await assert.rejects(service.execute('SELECT 1; DROP TABLE users'), { code: 'singleStatement' });
  await assert.rejects(service.execute('PRAGMA query_only = OFF'), { code: 'readOnlyQuery' });
  await assert.rejects(service.execute('SELECT load_extension(\'malicious\')'), /not authorized/);
  assert.equal((await service.execute('SELECT count(*) AS count FROM users')).rows[0]?.count, 206);
  const joined = await service.execute('SELECT u.id, v.name FROM users AS u JOIN names AS v ON u.id = v.id WHERE u.id = 2');
  assert.equal(joined.rows[0]?.name, 'User 2');
  const capped = await service.execute('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2000) SELECT * FROM n');
  assert.equal(capped.rows.length, 1000);
  assert.equal(capped.truncated, true);
  assert.deepEqual(await readFile(file), before);
});

test('invalid database and missing paths fail without creating a file', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sqlite-explorer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(SqliteDatabase.open(path.join(directory, 'missing.db')), /CANTOPEN/);
  const invalid = path.join(directory, 'invalid.db');
  await writeFile(invalid, 'this is not a SQLite database');
  await assert.rejects(SqliteDatabase.open(invalid), /NOTADB/);
});

test('expensive query is interrupted and connection remains usable', { timeout: 20_000 }, async t => {
  const { directory, file } = await fixture();
  const service = new DatabaseService(await SqliteDatabase.open(file));
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(service.execute('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n'), /interrupt/i);
  assert.equal((await service.execute('SELECT 42 AS answer')).rows[0]?.answer, 42);
});

test('SQL validation handles comments, quoted semicolons and stacked instructions', () => {
  for (const sql of ["-- hi\nSELECT ';'; -- end", '/* test */ WITH x AS (SELECT 1) SELECT * FROM x;', 'SELECT "a;" FROM "t"', "SELECT 'it''s fine'", 'EXPLAIN SELECT 1']) { assert.doesNotThrow(() => validateReadOnlySql(sql)); }
  for (const sql of ['', 'UPDATE t SET x=1', 'SELECT 1;;', 'SELECT 1; /* comment */ SELECT 2', "SELECT 'oops", '/* unclosed']) { assert.throws(() => validateReadOnlySql(sql)); }
});

test('CSV escapes quotes, newlines and formulas; JSON preserves data', () => {
  const result = { columns: ['name', 'value'], rows: [{ name: '=1+1', value: 'a,"b"\nc' }, { name: null, value: -2 }], truncated: false };
  const csv = exportResult(result, 'csv');
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.ok(csv.includes('"","-2"'));
  assert.deepEqual(JSON.parse(exportResult(result, 'json')), result.rows);
});

test('webview boundary rejects malformed and oversized requests', () => {
  for (const input of [null, {}, { type: 'query', sql: 1 }, { type: 'export', format: 'exe' }, { type: 'page', request: { table: 't', page: -1 } }, { type: 'query', sql: 'x'.repeat(100_001) }]) { assert.throws(() => parseMessage(input)); }
  assert.deepEqual(parseMessage({ type: 'export', format: 'csv' }), { type: 'export', format: 'csv' });
});

test('connection manager shares opens, retries failures and disposes once', async () => {
  let calls = 0; let closes = 0;
  const manager = new ConnectionManager(async () => {
    calls++;
    if (calls === 1) { throw new Error('unavailable'); }
    return new DatabaseService({ query: async () => ({ columns: [], rows: [], truncated: false }), close: async () => { closes++; } });
  });
  await assert.rejects(manager.open('key', 'path'), /unavailable/);
  const [a, b] = await Promise.all([manager.open('key', 'path'), manager.open('key', 'path')]);
  assert.equal(a, b);
  assert.equal(calls, 2);
  await manager.dispose();
  await manager.dispose();
  assert.equal(closes, 1);
});
