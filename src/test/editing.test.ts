import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { SqliteDatabase } from '../infrastructure/sqliteDatabase';
import { SqliteWriter } from '../infrastructure/sqliteWriter';
import { DatabaseService } from '../application/databaseService';
import { EditSession } from '../domain/editSession';
import { parseMessage } from '../webview/protocol';

async function fixture(t: TestContext): Promise<{ file: string; service: DatabaseService; external: (sql: string) => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sqlite-edits-'));
  const file = path.join(directory, 'editing.sqlite');
  const native = await new Promise<sqlite3.Database>((resolve, reject) => {
    const db = new sqlite3.Database(file, error => error ? reject(error) : resolve(db));
  });
  const external = (sql: string): Promise<void> => new Promise((resolve, reject) => native.exec(sql, error => error ? reject(error) : resolve()));
  await external(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE owners(id INTEGER PRIMARY KEY); INSERT INTO owners VALUES (1);
    CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT COLLATE NOCASE, qty INTEGER CHECK(qty>=0), owner INTEGER REFERENCES owners(id), payload BLOB, generated TEXT GENERATED ALWAYS AS (title||'!') STORED);
    INSERT INTO items(id,title,qty,owner,payload) VALUES (1,'First',3,1,X'AAFF'), (2,'Second',4,1,NULL);
    CREATE VIEW names AS SELECT id,title FROM items;
    CREATE TABLE no_key(title TEXT); INSERT INTO no_key VALUES ('read only');
    CREATE TABLE nullable_key(id TEXT PRIMARY KEY, title TEXT); INSERT INTO nullable_key VALUES(NULL,'ambiguous');
    CREATE TABLE big_key(id INTEGER PRIMARY KEY, title TEXT); INSERT INTO big_key VALUES(9223372036854775807,'unsafe');
    CREATE TABLE composite(a TEXT, b INTEGER, title TEXT, PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO composite VALUES('x',1,'original');
    CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY,"odd""column" TEXT); INSERT INTO "odd""table" VALUES(1,'quoted');`);
  const service = new DatabaseService(await SqliteDatabase.open(file), new SqliteWriter(file));
  t.after(async () => { await service.close(); await new Promise<void>((resolve, reject) => native.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); });
  return { file, service, external };
}
const request = { table: 'items', page: 0, filter: '', descending: false };

test('row editing is one atomic undoable command; protected fields reject the entire operation', async t => {
  const { service } = await fixture(t);
  const session = new EditSession(await service.page(request));
  session.editRow(0, { title: 'Grouped', qty: 12, owner: null });
  assert.equal(session.dirtyCount, 3);
  session.undo(); assert.equal(session.dirtyCount, 0);
  session.redo(); assert.equal(session.result.rows[0]?.title, 'Grouped'); assert.equal(session.result.rows[0]?.qty, 12);
  assert.throws(() => session.editRow(0, { title: 'must not apply', id: 42 }), { code: 'invalidEdit' });
  assert.equal(session.result.rows[0]?.title, 'Grouped');
  const restored = EditSession.restore(JSON.parse(JSON.stringify(session.toJSON())));
  restored.undo(); assert.equal(restored.dirtyCount, 0); restored.redo();
  restored.commit(await service.save(restored.changes()));
  assert.equal((await service.page(request)).rows[0]?.title, 'Grouped');
  assert.equal((await service.page(request)).rows[0]?.owner, null);
});

test('old single-cell drafts are migrated without losing undo or redo', async t => {
  const { service } = await fixture(t);
  const base = await service.page(request);
  const restored = EditSession.restore({ base, commands: [{ row: 0, column: 'title', before: 'First', after: 'Legacy' }], cursor: 1 });
  assert.equal(restored.result.rows[0]?.title, 'Legacy');
  restored.undo(); assert.equal(restored.result.rows[0]?.title, 'First');
  restored.redo(); assert.equal(restored.result.rows[0]?.title, 'Legacy');
});

test('cell edits remain staged; atomic save creates a WAL-consistent backup and acknowledges native values', async t => {
  const { service } = await fixture(t);
  const page = await service.page(request);
  assert.deepEqual(page.editing?.primaryKeys, ['id']);
  assert.ok(page.editing?.columns.includes('title'));
  assert.ok(!page.editing?.columns.includes('generated'));
  const session = new EditSession(page);
  session.edit(0, 'title', "O'Brien; DROP TABLE items; --");
  session.edit(0, 'qty', '12'); // INTEGER affinity is reflected after saving.
  session.edit(1, 'title', null);
  assert.equal(session.dirtyCount, 3);
  assert.equal((await service.page(request)).rows[0]?.title, 'First');
  const saved = await service.save(session.changes());
  session.commit(saved);
  assert.equal(session.dirtyCount, 0);
  assert.equal(session.canUndo, false);
  assert.equal(session.result.rows[0]?.qty, 12);
  assert.equal(session.result.rows[0]?.generated, "O'Brien; DROP TABLE items; --!");
  assert.equal((await service.page(request)).rows[1]?.title, null);
  const backup = await SqliteDatabase.open(saved.backupPath);
  try { assert.equal((await backup.query('SELECT title FROM items WHERE id=1')).rows[0]?.title, 'First'); }
  finally { await backup.close(); }
});

test('command history supports undo, redo, branching, discard and hot-exit recovery', async t => {
  const { service } = await fixture(t);
  const session = new EditSession(await service.page(request));
  session.edit(0, 'title', 'A'); session.edit(0, 'title', 'B'); session.edit(1, 'qty', 7);
  session.undo(); session.undo();
  assert.equal(session.result.rows[0]?.title, 'A');
  assert.equal(session.result.rows[1]?.qty, 4);
  const restored = EditSession.restore(JSON.parse(JSON.stringify(session.toJSON())));
  assert.equal(restored.canRedo, true);
  restored.redo(); restored.redo();
  assert.equal(restored.result.rows[0]?.title, 'B');
  assert.equal(restored.result.rows[1]?.qty, 7);
  restored.undo(); restored.edit(1, 'qty', 8);
  assert.equal(restored.canRedo, false);
  restored.discard();
  assert.equal(restored.dirtyCount, 0);
  assert.equal(restored.result.rows[0]?.title, 'First');
  assert.throws(() => restored.edit(0, 'id', 99), { code: 'invalidEdit' });
  assert.throws(() => restored.edit(0, 'payload', 'not a blob'), { code: 'invalidEdit' });
  assert.throws(() => restored.edit(0, 'generated', 'bad'), { code: 'invalidEdit' });
  assert.throws(() => restored.edit(0, 'qty', Number.MAX_SAFE_INTEGER + 1), { code: 'invalidEdit' });
});

test('constraint failures roll back every row, preserve the draft and leave the read connection read-only', async t => {
  const { service } = await fixture(t);
  const session = new EditSession(await service.page(request));
  session.edit(0, 'title', 'must roll back'); session.edit(1, 'owner', 999);
  await assert.rejects(service.save(session.changes()), /FOREIGN KEY/);
  assert.equal((await service.page(request)).rows[0]?.title, 'First');
  assert.equal(session.dirtyCount, 2);
  await assert.rejects(service.execute('WITH x AS (SELECT 1) DELETE FROM items'), /readonly/);
});

test('concurrent changes, including BLOBs and case-only changes, are detected without overwriting data', async t => {
  const { service, external } = await fixture(t);
  for (const sql of ["UPDATE items SET title='first' WHERE id=1", "UPDATE items SET payload=X'BBCC' WHERE id=1"]) {
    const session = new EditSession(await service.page(request)); session.edit(0, 'qty', 8);
    await external(sql);
    await assert.rejects(service.save(session.changes()), { code: 'editConflict' });
    assert.equal((await service.page(request)).rows[0]?.qty, 3);
    assert.equal(session.dirtyCount, 1);
  }
});

test('editing protects views, missing or null primary keys and unsafe integers; quoted and composite keys work', async t => {
  const { service } = await fixture(t);
  for (const table of ['names', 'no_key', 'nullable_key', 'big_key']) {
    const session = new EditSession(await service.page({ ...request, table }));
    assert.equal(session.canEdit(0, 'title'), false, table);
  }
  for (const [table, column] of [['composite', 'title'], ['odd"table', 'odd"column']]) {
    const session = new EditSession(await service.page({ ...request, table: table! }));
    session.edit(0, column!, 'updated');
    session.commit(await service.save(session.changes()));
    assert.equal((await service.page({ ...request, table: table! })).rows[0]?.[column!], 'updated');
  }
});

test('writer rejects forged schema, primary keys and protected columns; edit protocol validates values', async t => {
  const { service, external } = await fixture(t);
  const session = new EditSession(await service.page(request)); session.edit(0, 'title', 'new');
  const change = session.changes()[0]!;
  await assert.rejects(service.save([{ ...change, values: { id: 9 } }]), { code: 'invalidEdit' });
  await assert.rejects(service.save([{ ...change, primaryKeys: ['title'] }]), { code: 'invalidEdit' });
  await external('ALTER TABLE items ADD COLUMN added TEXT');
  await assert.rejects(service.save(session.changes()), { code: 'editConflict' });
  for (const input of [{ type: 'edit', row: -1, column: 'title', value: 'x' }, { type: 'edit', row: 0, column: 'title', value: {} }, { type: 'edit', row: 0, column: 'title', value: Infinity }, { type: 'edit', row: 0, column: 'title', value: 'x'.repeat(65537) }]) { assert.throws(() => parseMessage(input)); }
  assert.deepEqual(parseMessage({ type: 'edit', row: 1, column: 'title', value: null }), { type: 'edit', row: 1, column: 'title', value: null });
  assert.deepEqual(parseMessage({ type: 'editRow', row: 0, values: { title: 'New', qty: 2 } }), { type: 'editRow', row: 0, values: { title: 'New', qty: 2 } });
  for (const values of [{}, [], { title: 'valid', qty: true }, { title: 'x'.repeat(65537) }]) { assert.throws(() => parseMessage({ type: 'editRow', row: 0, values })); }
});
