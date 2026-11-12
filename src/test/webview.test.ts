import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { messages as translations } from '../localization';

function enableDialogs(dom: JSDOM): void {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
}

test('webview handshake, pagination, sorting and hostile values use the actual UI script', async t => {
  const html = '<select id="tables"></select><input id="filter"><textarea id="sql"></textarea><p id="path"></p><p id="status"></p><div id="grid"></div><span id="pagination"></span><section id="editing"><span id="pending"></span></section>' + ['apply', 'refresh', 'run', 'previous', 'next', 'csv', 'json', 'save', 'undo', 'redo', 'discard'].map(id => `<button id="${id}"></button>`).join('');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const messages: Record<string, unknown>[] = [];
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => messages.push(m), getState: () => undefined, setState: () => undefined }) });
  dom.window.eval(await readFile(path.resolve(__dirname, '../../media/main.js'), 'utf8'));
  const receive = (data: unknown): void => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })); };
  const click = (id: string): void => { (dom.window.document.getElementById(id) as HTMLButtonElement).click(); };
  assert.equal(messages[0]?.type, 'ready');
  receive({ type: 'schema', objects: [{ name: 'users', type: 'table' }], path: 'test.sqlite', messages: translations('en') });
  receive({ type: 'idle' });
  assert.equal(messages[1]?.type, 'page');
  receive({ type: 'result', page: 0, result: { columns: ['name'], rows: [{ name: '<img src=x onerror=alert(1)>' }], truncated: true } });
  receive({ type: 'idle' });
  assert.equal(dom.window.document.querySelector('td')?.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(dom.window.document.querySelector('img'), null);
  click('next');
  assert.equal((messages.at(-1)?.request as Record<string, unknown>).page, 1);
  receive({ type: 'result', page: 1, result: { columns: ['name'], rows: [], truncated: false } });
  receive({ type: 'idle' });
  assert.equal((dom.window.document.getElementById('next') as HTMLButtonElement).disabled, true);
  (dom.window.document.querySelector('th button') as HTMLButtonElement).click();
  assert.equal((messages.at(-1)?.request as Record<string, unknown>).sort, 'name');
  receive({ type: 'error', message: 'Invalid SQL' });
  receive({ type: 'idle' });
  assert.equal(dom.window.document.getElementById('status')?.textContent, 'Invalid SQL');
  assert.equal((dom.window.document.getElementById('csv') as HTMLButtonElement).disabled, true);
});

for (const language of ['en', 'pt'] as const) {
  test(`SQL query mode waits for execution and supports JOINs (${language})`, async t => {
    const html = '<select id="tables"></select><input id="filter"><textarea id="sql"></textarea><p id="path"></p><p id="status"></p><div id="grid"></div><span id="pagination"></span><section id="editing"><span id="pending"></span></section>' + ['apply', 'refresh', 'run', 'previous', 'next', 'csv', 'json', 'save', 'undo', 'redo', 'discard'].map(id => `<button id="${id}"></button>`).join('');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const sent: Record<string, unknown>[] = [];
    Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => sent.push(m), getState: () => undefined, setState: () => undefined }) });
    dom.window.eval(await readFile(path.resolve(__dirname, '../../media/main.js'), 'utf8'));
    const receive = (data: unknown): void => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })); };
    const labels = translations(language);
    receive({ type: 'schema', objects: [{ name: 'users', type: 'table' }], path: 'db.sqlite', queryMode: true, messages: labels });
    receive({ type: 'idle' });
    assert.equal(sent.length, 1, 'query editor must not execute an automatic table query');
    assert.equal(dom.window.document.getElementById('status')?.textContent, labels.queryReady);
    assert.equal(dom.window.document.activeElement?.id, 'sql');
    const sql = 'SELECT u.id, p.name FROM users u JOIN products p ON p.id = u.product_id';
    (dom.window.document.getElementById('sql') as HTMLTextAreaElement).value = sql;
    (dom.window.document.getElementById('run') as HTMLButtonElement).click();
    assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'query', sql });
    receive({ type: 'result', result: { columns: ['id'], rows: [{ id: 1 }], truncated: false } });
    receive({ type: 'idle' });
    assert.equal(dom.window.document.getElementById('pagination')?.textContent, labels.queryResult);
    assert.ok(dom.window.document.getElementById('status')?.textContent?.includes(labels.exportHint));
    receive({ type: 'select', table: 'users' });
    assert.equal(sent.at(-1)?.type, 'page');
    // A second sidebar click while the first query runs must be replayed after idle.
    receive({ type: 'select', table: 'users' });
    receive({ type: 'result', page: 3, result: { columns: ['id'], rows: [{ id: 1 }], truncated: true } });
    receive({ type: 'idle' });
    assert.equal((sent.at(-1)?.request as Record<string, unknown>).page, 0);
  });
}

test('editable grid stages typed values and exposes undo/redo without discarding drafts on error', async t => {
  const html = '<select id="tables"></select><input id="filter"><textarea id="sql"></textarea><p id="path"></p><p id="status"></p><div id="grid"></div><span id="pagination"></span><section id="editing"><span id="pending"></span></section>' + ['apply', 'refresh', 'run', 'previous', 'next', 'csv', 'json', 'save', 'undo', 'redo', 'discard'].map(id => `<button id="${id}"></button>`).join('');
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  enableDialogs(dom);
  const sent: Record<string, unknown>[] = [];
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => sent.push(message), getState: () => undefined, setState: () => undefined }) });
  dom.window.eval(await readFile(path.resolve(__dirname, '../../media/main.js'), 'utf8'));
  const receive = (data: unknown): void => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })); };
  const click = (id: string): void => { (dom.window.document.getElementById(id) as HTMLButtonElement).click(); };
  const labels = translations('pt');
  receive({ type: 'schema', messages: labels, objects: [{ type: 'table', name: 'items' }], queryMode: false }); receive({ type: 'idle' });
  const result = { columns: ['id', 'title'], rows: [{ id: 1, title: 'Original' }], truncated: false, snapshots: [{ fingerprint: 'a'.repeat(64), safe: true, types: { id: 'number', title: 'text' } }], editing: { table: 'items', primaryKeys: ['id'], columns: ['title'], schemaSql: '' } };
  const request = { table: 'items', page: 0, filter: '', descending: false };
  receive({ type: 'result', result, page: 0 }); receive({ type: 'edits', result, request, dirtyCount: 0, canUndo: false, canRedo: false }); receive({ type: 'idle' });
  assert.equal(dom.window.document.querySelectorAll('td.editable').length, 1);
  dom.window.document.querySelector('td.editable')!.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll('.row-fields .row-field').length, 2);
  assert.equal((dom.window.document.getElementById('row-field-0') as HTMLTextAreaElement).readOnly, true);
  (dom.window.document.getElementById('row-field-1') as HTMLTextAreaElement).value = 'Edited';
  dom.window.document.querySelector('.row-dialog form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'editRow', row: 0, values: { title: 'Edited' } });
  const changed = { ...result, rows: [{ id: 1, title: 'Edited' }] };
  receive({ type: 'edits', result: changed, request, dirtyCount: 1, canUndo: true, canRedo: false }); receive({ type: 'idle' });
  assert.equal(dom.window.document.querySelector('dialog'), null);
  assert.equal((dom.window.document.getElementById('save') as HTMLButtonElement).disabled, false);
  assert.equal((dom.window.document.getElementById('refresh') as HTMLButtonElement).disabled, true);
  click('undo'); assert.equal(sent.at(-1)?.type, 'undo');
  receive({ type: 'edits', result, request, dirtyCount: 0, canUndo: false, canRedo: true }); receive({ type: 'idle' });
  click('redo'); assert.equal(sent.at(-1)?.type, 'redo');
  receive({ type: 'edits', result: changed, request, dirtyCount: 1, canUndo: true, canRedo: false }); receive({ type: 'idle' });
  click('save'); assert.equal(sent.at(-1)?.type, 'save');
  receive({ type: 'editError', message: labels.editConflict }); receive({ type: 'idle' });
  assert.ok(dom.window.document.querySelector('td.editable')?.textContent?.includes('Edited'));
  assert.equal((dom.window.document.getElementById('save') as HTMLButtonElement).disabled, false);
});

test('row modal validates all fields before sending, supports Cancel/Escape and protects query results', async t => {
  const html = '<select id="tables"></select><input id="filter"><textarea id="sql"></textarea><p id="path"></p><p id="status"></p><div id="grid"></div><span id="pagination"></span><section id="editing"><span id="pending"></span></section>' + ['apply', 'refresh', 'run', 'previous', 'next', 'csv', 'json', 'save', 'undo', 'redo', 'discard'].map(id => `<button id="${id}"></button>`).join('');
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close()); enableDialogs(dom);
  const sent: Record<string, unknown>[] = [];
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => sent.push(message), getState: () => undefined, setState: () => undefined }) });
  dom.window.eval(await readFile(path.resolve(__dirname, '../../media/main.js'), 'utf8'));
  const receive = (data: unknown): void => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })); };
  receive({ type: 'schema', messages: translations('en'), objects: [{ type: 'table', name: 'items' }] }); receive({ type: 'idle' });
  const result = { columns: ['id', 'title', 'qty'], rows: [{ id: 1, title: 'Original', qty: 2 }], truncated: false, snapshots: [{ fingerprint: 'a'.repeat(64), safe: true, types: { id: 'number', title: 'text', qty: 'number' } }], editing: { table: 'items', primaryKeys: ['id'], columns: ['title', 'qty'], schemaSql: '' } };
  receive({ type: 'result', result, page: 0 }); receive({ type: 'idle' });
  const open = (): void => { dom.window.document.querySelector('tbody tr')!.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })); };
  const submit = (): void => { dom.window.document.querySelector('dialog form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); };
  open();
  (dom.window.document.getElementById('row-field-1') as HTMLTextAreaElement).value = 'Still a draft';
  (dom.window.document.getElementById('row-field-2') as HTMLTextAreaElement).value = 'invalid';
  const before = sent.length; submit();
  assert.equal(sent.length, before, 'invalid row must not send even the valid fields');
  assert.equal((dom.window.document.getElementById('row-field-1') as HTMLTextAreaElement).value, 'Still a draft');
  assert.ok(dom.window.document.querySelector('.row-error')?.textContent);
  (dom.window.document.querySelector('.row-dialog-actions button') as HTMLButtonElement).click();
  assert.equal(dom.window.document.querySelector('dialog'), null); assert.equal(sent.length, before);
  open(); dom.window.document.querySelector('dialog')!.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
  assert.equal(dom.window.document.querySelector('dialog'), null);
  receive({ type: 'result', result: { columns: ['value'], rows: [{ value: '<img src=x onerror=alert(1)>' }], truncated: false } }); receive({ type: 'idle' });
  open();
  assert.equal((dom.window.document.getElementById('row-field-0') as HTMLTextAreaElement).readOnly, true);
  assert.equal((dom.window.document.querySelector('.row-dialog button[type="submit"]') as HTMLButtonElement).hidden, true);
  assert.equal(dom.window.document.querySelector('img'), null);
});
