import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { Connection } from '../application/connectionManager';
import { exportResult } from '../application/exportResult';
import { PageRequest, Result } from '../domain/database';
import { parseMessage } from './protocol';
import { Language, messages, errorMessage } from '../localization';
import { AppError } from '../domain/errors';
import { EditSession } from '../domain/editSession';

export interface EditorLifecycle { changed(): void; save(): Promise<void>; revert(): Promise<void>; draft?: unknown }

export class TableEditor implements vscode.Disposable {
  private readonly listeners: vscode.Disposable[] = [];
  private result?: Result;
  private busy = false;
  private ready = false;
  private selectedTable?: string;
  private session?: EditSession;
  private pageRequest?: PageRequest;
  private saving?: Promise<void>;
  constructor(readonly panel: vscode.WebviewPanel, readonly connection: Connection, extensionUri: vscode.Uri, private readonly language: Language, private queryMode = false, private readonly lifecycle?: EditorLifecycle) {
    if (lifecycle?.draft) {
      const draft = lifecycle.draft as { request?: unknown; session?: unknown };
      const parsed = parseMessage({ type: 'page', request: draft.request });
      if (parsed.type !== 'page') { throw new AppError('invalidEdit'); }
      this.session = EditSession.restore(draft.session);
      if (this.session.result.editing?.table !== parsed.request.table) { throw new AppError('invalidEdit'); }
      this.pageRequest = parsed.request; this.selectedTable = parsed.request.table;
      this.result = this.session.result;
    }
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
    webview.html = this.html(extensionUri);
    this.listeners.push(webview.onDidReceiveMessage((message: unknown) => void this.receive(message)));
  }
  selectTable(table: string, column = this.panel.viewColumn): void {
    if (this.session?.dirtyCount) { void vscode.window.showWarningMessage(messages(this.language).pendingEdits); return; }
    this.queryMode = false;
    this.selectedTable = table;
    this.panel.reveal(column, true);
    if (this.ready) { void this.panel.webview.postMessage({ type: 'select', table }); }
  }
  exportDraft(): unknown { return this.session && this.pageRequest ? { request: this.pageRequest, session: this.session.toJSON() } : null; }
  async discardEdits(): Promise<void> {
    if (this.pageRequest) {
      const result = await this.connection.service.page(this.pageRequest);
      this.session = new EditSession(result);
      this.result = result;
      await this.postEditState();
    }
  }
  saveEdits(): Promise<void> {
    if (this.saving) { return this.saving; }
    this.saving = this.persistEdits().finally(() => { this.saving = undefined; });
    return this.saving;
  }
  private async persistEdits(): Promise<void> {
    if (!this.session?.dirtyCount) { return; }
    await this.panel.webview.postMessage({ type: 'saving' });
    try {
      const saved = await this.connection.service.save(this.session.changes());
      this.session.commit(saved);
      this.result = this.session.result;
      await this.postEditState();
      await this.panel.webview.postMessage({ type: 'saved', backupPath: saved.backupPath });
    } catch (error) {
      await this.panel.webview.postMessage({ type: 'editError', message: errorMessage(error, this.language) });
      throw error;
    } finally { await this.panel.webview.postMessage({ type: 'idle' }); }
  }
  private async postEditState(): Promise<void> {
    if (!this.session) { return; }
    this.result = this.session.result;
    await this.panel.webview.postMessage({ type: 'edits', result: this.result, request: this.pageRequest, canUndo: this.session.canUndo, canRedo: this.session.canRedo, dirtyCount: this.session.dirtyCount });
  }
  private async receive(raw: unknown): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const message = parseMessage(raw);
      if ((message.type === 'page' || message.type === 'query' || message.type === 'refresh') && this.session?.dirtyCount) { throw new AppError('pendingEdits'); }
      if (message.type === 'ready' || message.type === 'refresh') {
        const schema = await this.connection.service.schema();
        this.ready = true;
        await this.panel.webview.postMessage({ type: 'schema', objects: schema, path: this.connection.path, selectedTable: this.selectedTable, queryMode: this.queryMode, hasDraft: message.type === 'ready' && Boolean(this.session), messages: messages(this.language) });
        if (message.type === 'ready' && this.session) { await this.postEditState(); }
      } else if (message.type === 'page' || message.type === 'query') {
        this.queryMode = message.type === 'query';
        if (message.type === 'page') { this.selectedTable = message.request.table; }
        this.result = undefined;
        const result = message.type === 'page' ? await this.connection.service.page(message.request) : await this.connection.service.execute(message.sql);
        if (!this.lifecycle) { delete result.editing; }
        this.pageRequest = message.type === 'page' ? message.request : undefined;
        this.session = message.type === 'page' ? new EditSession(result) : undefined;
        this.result = result;
        await this.panel.webview.postMessage({ type: 'result', result, page: message.type === 'page' ? message.request.page : undefined });
        if (this.session) { await this.postEditState(); }
      } else if (message.type === 'edit' || message.type === 'editRow' || message.type === 'undo' || message.type === 'redo') {
        if (!this.lifecycle || !this.session) { throw new AppError('editingUnavailable'); }
        if (message.type === 'edit') { this.session.edit(message.row, message.column, message.value); }
        else if (message.type === 'editRow') { this.session.editRow(message.row, message.values); }
        else { this.session[message.type](); }
        this.lifecycle.changed();
        await this.postEditState();
      } else if (message.type === 'save') {
        await this.lifecycle?.save();
      } else if (message.type === 'discard') {
        await this.lifecycle?.revert();
      } else if (message.type === 'export') {
        if (!this.result) { throw new AppError('noResult'); }
        const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(vscode.Uri.file(this.connection.path), '..', `resultado.${message.format}`), filters: { [message.format.toUpperCase()]: [message.format] } });
        if (uri) {
          if (uri.scheme !== 'file' || path.extname(uri.fsPath).toLowerCase() !== `.${message.format}`) { throw new AppError('invalidExport'); }
          const canonical = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
          const destination = await realpath(uri.fsPath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') { return uri.fsPath; } throw error; });
          if (canonical(destination) === canonical(await realpath(this.connection.path))) { throw new AppError('overwriteDatabase'); }
          await vscode.workspace.fs.writeFile(uri, Buffer.from(exportResult(this.result, message.format), 'utf8'));
          void vscode.window.showInformationMessage(messages(this.language).exported);
        }
      }
    } catch (error) {
      await this.panel.webview.postMessage({ type: this.session ? 'editError' : 'error', message: errorMessage(error, this.language) });
    } finally {
      this.busy = false;
      await this.panel.webview.postMessage({ type: 'idle' });
    }
  }
  private html(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(18).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const t = messages(this.language);
    const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    return `<!DOCTYPE html><html lang="${this.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>SQLite Explorer</title></head><body>
      <header><div><span class="eyebrow">SQLITE EXPLORER</span><h1>${t.heading}</h1><p id="path"></p></div><span id="mode" class="badge">${t.readOnly}</span></header>
      <main><section aria-label="${t.tableOrView}"><div class="toolbar"><label>${t.tableOrView}<select id="tables" aria-label="${t.tableOrView}"></select></label><label class="grow">${t.filter}<input id="filter" type="search" maxlength="1000" placeholder="${t.search}"></label><button id="apply">${t.applyFilter}</button><button id="refresh" class="secondary">${t.refresh}</button></div><p class="hint">${t.browseHint}</p></section>
      <section aria-label="${t.sqlQuery}"><label for="sql">${t.sqlQuery}</label><textarea id="sql" spellcheck="false" placeholder="${escape(t.queryPlaceholder)}"></textarea><div class="toolbar"><button id="run">${t.runQuery}</button><span class="hint grow">${t.queryHint}</span><button id="csv" class="secondary" disabled>${t.exportCsv}</button><button id="json" class="secondary" disabled>${t.exportJson}</button></div></section>
      <section id="editing" aria-label="${t.editing}"><div class="toolbar"><button id="save" disabled>${t.save}</button><button id="undo" class="secondary" disabled>${t.undo}</button><button id="redo" class="secondary" disabled>${t.redo}</button><button id="discard" class="secondary" disabled>${t.discard}</button><span id="pending" class="hint"></span></div><p class="hint">${t.editHint}</p></section>
      <div id="status" role="status" aria-live="polite">${t.opening}</div><section class="results" aria-label="${t.queryResult}"><div id="grid"><p class="empty">${t.emptyStart}</p></div></section><footer><button id="previous" class="secondary" disabled>${t.previous}</button><span id="pagination">${t.page.replace('{page}', '1')}</span><button id="next" class="secondary" disabled>${t.next}</button></footer></main><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
  dispose(): void { this.listeners.splice(0).forEach(listener => listener.dispose()); }
}
