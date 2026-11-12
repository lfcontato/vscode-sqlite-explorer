/* global acquireVsCodeApi */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const saved = vscode.getState() || {};
  let page = 0;
  let sort;
  let descending = false;
  let busy = true;
  let hasNext = false;
  let tableMode = true;
  let hasResult = false;
  let autoLoad = false;
  let focusQuery = false;
  let labels = {};
  let currentResult;
  let dirtyCount = 0;
  let canUndo = false;
  let canRedo = false;
  let cellEditorOpen = false;
  let rowDialog;
  const text = (key, values = {}) => String(labels[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  let preferredTable = saved.table;
  $('sql').value = saved.sql || '';
  function remember() { vscode.setState({ table: $('tables').value, sql: $('sql').value }); }
  function controls() {
    const blocked = busy || dirtyCount > 0 || cellEditorOpen;
    for (const id of ['tables', 'filter', 'apply', 'refresh', 'run']) { $(id).disabled = blocked; }
    $('sql').disabled = busy;
    for (const button of document.querySelectorAll('th button')) { button.disabled = blocked; }
    $('previous').disabled = blocked || !tableMode || page === 0;
    $('next').disabled = blocked || !tableMode || !hasNext;
    $('csv').disabled = $('json').disabled = busy || !hasResult;
    $('save').disabled = $('discard').disabled = busy || !dirtyCount || cellEditorOpen;
    $('undo').disabled = busy || !canUndo || cellEditorOpen;
    $('redo').disabled = busy || !canRedo || cellEditorOpen;
    $('editing').hidden = !currentResult?.editing;
    $('pending').textContent = dirtyCount ? text('pendingCount', { count: dirtyCount }) : '';
    if ($('mode')) { $('mode').textContent = text(currentResult?.editing ? 'editing' : 'readOnly'); }
    if (rowDialog) {
      rowDialog.apply.disabled = busy;
      rowDialog.cancel.disabled = busy;
      for (const field of rowDialog.fields) { field.type.disabled = busy || !field.canEdit; field.input.disabled = busy || (field.canEdit && field.type.value === 'null'); }
    }
  }
  function send(message) {
    if (busy) { return; }
    if ((dirtyCount || cellEditorOpen) && ['page', 'query', 'refresh'].includes(message.type)) { $('status').textContent = text('pendingEdits'); return; }
    busy = true;
    controls();
    $('status').classList.remove('error');
    $('status').textContent = text(message.type === 'export' ? 'exporting' : 'loading');
    vscode.postMessage(message);
  }
  function load() {
    if (!$('tables').value) { return; }
    tableMode = true;
    remember();
    send({ type: 'page', request: { table: $('tables').value, page, sort, descending, filter: $('filter').value } });
  }
  function selectTable(name) {
    if (dirtyCount || cellEditorOpen) { $('status').textContent = text('pendingEdits'); return; }
    if (![...$('tables').options].some(option => option.value === name)) { return; }
    $('tables').value = name;
    page = 0; sort = undefined; descending = false; $('filter').value = '';
    $('sql').value = `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 100;`;
    if (busy) { autoLoad = true; } else { load(); }
  }
  function editable(rowIndex, column, result) {
    const info = result.editing;
    const snapshot = result.snapshots?.[rowIndex];
    return info && snapshot?.safe && info.columns.includes(column) && snapshot.types[column] !== 'blob' && info.primaryKeys.every(key => result.rows[rowIndex][key] != null);
  }
  function closeRowEditor() {
    if (!rowDialog) { return; }
    const modal = rowDialog; rowDialog = undefined; cellEditorOpen = false;
    if (modal.dialog.open) { modal.dialog.close(); }
    modal.dialog.remove(); controls();
    document.querySelector(`tr[data-row-index="${modal.rowIndex}"]`)?.focus();
  }
  function openRowEditor(rowIndex, result) {
    if (busy || cellEditorOpen) { return; }
    cellEditorOpen = true;
    const dialog = document.createElement('dialog'); dialog.className = 'row-dialog'; dialog.setAttribute('aria-labelledby', 'row-dialog-title');
    const form = document.createElement('form');
    const heading = document.createElement('h2'); heading.id = 'row-dialog-title';
    const subtitle = document.createElement('p'); subtitle.className = 'hint'; subtitle.textContent = text('rowPosition', { table: tableMode ? $('tables').value : text('queryResult'), row: tableMode ? page * 100 + rowIndex + 1 : rowIndex + 1 });
    const fieldsContainer = document.createElement('div'); fieldsContainer.className = 'row-fields';
    const fields = [];
    for (const [index, column] of result.columns.entries()) {
      const value = result.rows[rowIndex][column];
      const canEdit = Boolean(editable(rowIndex, column, result));
      const group = document.createElement('div'); group.className = 'row-field';
      const label = document.createElement('label'); label.htmlFor = `row-field-${index}`; label.textContent = column;
      const type = document.createElement('select'); type.className = 'row-field-type'; type.setAttribute('aria-label', column + ' · ' + text('cellText') + '/' + text('cellNumber') + '/NULL');
      for (const [key, title] of [['text', 'cellText'], ['number', 'cellNumber'], ['null', 'cellNull']]) { const option = document.createElement('option'); option.value = key; option.textContent = text(title); type.append(option); }
      type.value = value === null ? 'null' : typeof value === 'number' ? 'number' : 'text'; type.hidden = !canEdit;
      const input = document.createElement('textarea'); input.id = label.htmlFor; input.className = 'row-field-input'; input.rows = 2; input.maxLength = 65536; input.value = value === null ? (canEdit ? '' : 'NULL') : String(value); input.readOnly = !canEdit;
      type.addEventListener('change', () => { input.disabled = type.value === 'null'; });
      group.append(label, type, input);
      if (!canEdit) { const note = document.createElement('small'); note.className = 'hint'; note.textContent = text('protectedField'); group.append(note); }
      fieldsContainer.append(group); fields.push({ column, original: value, type, input, canEdit });
    }
    const hasEditable = fields.some(field => field.canEdit);
    heading.textContent = text(hasEditable ? 'editRow' : 'rowDetails');
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = text(hasEditable ? 'rowModalHint' : 'readOnly');
    const error = document.createElement('p'); error.className = 'row-error'; error.setAttribute('role', 'alert');
    const actions = document.createElement('div'); actions.className = 'row-dialog-actions';
    const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = text('apply'); apply.hidden = !hasEditable;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = text('cancel'); cancel.addEventListener('click', closeRowEditor);
    actions.append(cancel, apply);
    const submit = () => {
      if (busy || !hasEditable) { return; }
      const values = [];
      for (const field of fields.filter(field => field.canEdit)) {
        const value = field.type.value === 'null' ? null : field.type.value === 'number' ? Number(field.input.value) : field.input.value;
        if (field.type.value === 'number' && (!field.input.value.trim() || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) { error.textContent = text('invalidEdit'); field.input.focus(); return; }
        if (value !== field.original) { values.push([field.column, value]); }
      }
      if (!values.length) { closeRowEditor(); return; }
      error.textContent = ''; send({ type: 'editRow', row: rowIndex, values: Object.fromEntries(values) });
    };
    form.addEventListener('submit', event => { event.preventDefault(); submit(); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } });
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) { closeRowEditor(); } });
    form.append(heading, subtitle, fieldsContainer, hint, error, actions); dialog.append(form); document.body.append(dialog);
    rowDialog = { dialog, fields, apply, cancel, error, rowIndex }; controls(); dialog.showModal();
    (fields.find(field => field.canEdit)?.input || cancel).focus();
  }
  function render(result) {
    $('grid').replaceChildren();
    if (!result.columns.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = text('noRows'); $('grid').append(empty); return;
    }
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const column of result.columns) {
      const th = document.createElement('th');
      if (tableMode) {
        const button = document.createElement('button'); button.className = 'column';
        button.textContent = column + (column === sort ? (descending ? ' ↓' : ' ↑') : '');
        button.title = text('sortBy', { column });
        button.addEventListener('click', () => { descending = sort === column ? !descending : false; sort = column; page = 0; load(); });
        th.append(button);
      } else { th.textContent = column; }
      head.append(th);
    }
    const body = table.createTBody();
    for (const [rowIndex, row] of result.rows.entries()) {
      const tr = body.insertRow();
      tr.dataset.rowIndex = rowIndex; tr.tabIndex = 0; tr.className = 'data-row';
      tr.setAttribute('aria-label', text('rowPosition', { table: tableMode ? $('tables').value : text('queryResult'), row: rowIndex + 1 }));
      tr.addEventListener('dblclick', () => openRowEditor(rowIndex, result));
      tr.addEventListener('keydown', event => { if (event.target === tr && event.key === 'Enter') { event.preventDefault(); openRowEditor(rowIndex, result); } });
      for (const column of result.columns) {
        const td = tr.insertCell(); const value = row[column];
        td.textContent = value === null ? 'NULL' : String(value ?? '');
        if (value === null) { td.className = 'null'; }
        td.title = td.textContent;
        if (editable(rowIndex, column, result)) {
          td.classList.add('editable');
        }
      }
    }
    $('grid').append(table);
    if (!result.rows.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = text('noRows'); $('grid').append(empty); }
  }
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'schema') {
      labels = data.messages;
      $('path').textContent = data.path;
      const current = data.selectedTable || preferredTable || $('tables').value;
      $('tables').replaceChildren();
      for (const item of data.objects.filter(item => item.type !== 'index')) {
        const option = document.createElement('option'); option.value = item.name; option.textContent = `${item.name}${item.type === 'view' ? ' · view' : ''}`; $('tables').append(option);
      }
      if (data.hasDraft) { autoLoad = false; }
      else if (data.queryMode) {
        autoLoad = false; tableMode = false; focusQuery = true;
        $('status').textContent = text('queryReady');
        $('pagination').textContent = text('queryResult');
      } else if ($('tables').options.length) { selectTable(current && [...$('tables').options].some(item => item.value === current) ? current : $('tables').value); }
      else { $('status').textContent = text('emptyDatabase'); }
      preferredTable = undefined;
    } else if (data.type === 'select') { selectTable(data.table); }
    else if (data.type === 'result') {
      closeRowEditor();
      currentResult = data.result; dirtyCount = 0; canUndo = false; canRedo = false; cellEditorOpen = false;
      hasResult = true; hasNext = data.result.truncated;
      if (typeof data.page === 'number') { page = data.page; }
      render(data.result);
      $('status').textContent = `${text('rowCount', { count: data.result.rows.length })}${data.result.truncated ? ' · ' + text(tableMode ? 'moreRows' : 'limited') : ''}. ${text('exportHint')}`;
      $('pagination').textContent = tableMode ? text('page', { page: page + 1 }) : text('queryResult');
    } else if (data.type === 'edits') {
      const editedRowIndex = rowDialog?.rowIndex;
      closeRowEditor();
      currentResult = data.result; hasResult = true; cellEditorOpen = false;
      dirtyCount = data.dirtyCount; canUndo = data.canUndo; canRedo = data.canRedo;
      if (data.request) { page = data.request.page; sort = data.request.sort; descending = data.request.descending; $('tables').value = data.request.table; $('filter').value = data.request.filter; tableMode = true; $('pagination').textContent = text('page', { page: page + 1 }); }
      hasNext = data.result.truncated;
      render(data.result);
      if (editedRowIndex !== undefined) { document.querySelector(`tr[data-row-index="${editedRowIndex}"]`)?.focus(); }
      $('status').textContent = dirtyCount ? text('pendingCount', { count: dirtyCount }) : text('rowCount', { count: data.result.rows.length });
    } else if (data.type === 'saving') { busy = true; controls(); }
    else if (data.type === 'saved') { $('status').textContent = text('savedChanges', { path: data.backupPath }); }
    else if (data.type === 'editError') {
      if (rowDialog) { rowDialog.error.textContent = data.message; }
      else if (currentResult) { render(currentResult); }
      $('status').textContent = data.message; $('status').classList.add('error');
    } else if (data.type === 'error') {
      closeRowEditor();
      currentResult = undefined; dirtyCount = 0; canUndo = false; canRedo = false;
      hasResult = false; hasNext = false;
      $('grid').replaceChildren();
      $('status').textContent = data.message; $('status').classList.add('error');
    } else if (data.type === 'idle') {
      busy = false; controls();
      if (autoLoad) { autoLoad = false; page = 0; load(); }
      else if ($('status').textContent === text('exporting')) { $('status').textContent = text('exportFinished'); }
      if (focusQuery) { focusQuery = false; $('sql').focus(); }
    }
  });
  $('tables').addEventListener('change', () => selectTable($('tables').value));
  $('apply').addEventListener('click', () => { page = 0; load(); });
  $('filter').addEventListener('keydown', event => { if (event.key === 'Enter') { page = 0; load(); } });
  $('refresh').addEventListener('click', () => send({ type: 'refresh' }));
  $('previous').addEventListener('click', () => { page--; load(); });
  $('next').addEventListener('click', () => { page++; load(); });
  function run() { tableMode = false; remember(); send({ type: 'query', sql: $('sql').value }); }
  $('run').addEventListener('click', run);
  $('sql').addEventListener('input', remember);
  $('sql').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); } });
  for (const format of ['csv', 'json']) { $(format).addEventListener('click', () => send({ type: 'export', format })); }
  for (const action of ['save', 'undo', 'redo', 'discard']) { $(action).addEventListener('click', () => send({ type: action })); }
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) { return; }
    const key = event.key.toLowerCase();
    const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : undefined;
    if (action && !$(action).disabled) { event.preventDefault(); send({ type: action }); }
  });
  controls();
  vscode.postMessage({ type: 'ready' });
})();
