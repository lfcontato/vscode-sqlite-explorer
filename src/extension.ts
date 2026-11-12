import * as vscode from 'vscode';
import * as path from 'node:path';
import { DatabaseService } from './application/databaseService';
import { Connection, ConnectionManager } from './application/connectionManager';
import { SqliteDatabase } from './infrastructure/sqliteDatabase';
import { DatabaseTreeProvider, ExplorerItem } from './explorer/treeProvider';
import { TableEditor } from './webview/tableEditor';
import { errorMessage, messages, resolveLanguage } from './localization';
import { AppError } from './domain/errors';
import { SqliteWriter } from './infrastructure/sqliteWriter';

interface DatabaseDocument extends vscode.CustomDocument { editor?: TableEditor; draft?: unknown }

let manager: ConnectionManager | undefined;

/** Composition root: all concrete dependencies are wired here. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const language = resolveLanguage(vscode.workspace.getConfiguration('sqliteExplorer').get('language', 'auto'), vscode.env.language);
  const t = messages(language);
  const output = vscode.window.createOutputChannel('SQLite Explorer');
  const connections = new ConnectionManager(async file => new DatabaseService(await SqliteDatabase.open(file), new SqliteWriter(file)));
  manager = connections;
  const tree = new DatabaseTreeProvider(connections, language);
  const editors = new Set<TableEditor>();
  const pendingTables = new Map<string, string>();
  const documentChanged = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<DatabaseDocument>>();
  const filesView = vscode.window.createTreeView('sqliteExplorer.files', { treeDataProvider: tree });
  const dedicatedView = vscode.window.createTreeView('sqliteExplorer.databases', { treeDataProvider: tree });
  context.subscriptions.push(output, tree, filesView, dedicatedView, documentChanged);

  const remember = async (): Promise<void> => {
    await context.workspaceState.update('openDatabases', (await connections.all()).map(connection => connection.key));
  };
  const reveal = async (connection?: Connection): Promise<void> => {
    const view = dedicatedView.visible ? dedicatedView : filesView;
    const root = (await tree.getChildren()).find(item => item.connection.key === connection?.key);
    if (root) { await view.reveal(root, { expand: 2, focus: false, select: false }); }
    else { await vscode.commands.executeCommand('sqliteExplorer.files.focus'); }
  };
  const connect = async (uri: vscode.Uri): Promise<Connection> => {
    if (!vscode.workspace.isTrusted) { throw new AppError('untrustedWorkspace'); }
    if (uri.scheme !== 'file') { throw new AppError('unsupportedFile'); }
    const connection = await connections.open(uri.toString(), uri.fsPath);
    tree.refresh();
    await remember();
    return connection;
  };
  const attach = async (uri: vscode.Uri, panel: vscode.WebviewPanel, queryMode = false, document?: DatabaseDocument): Promise<TableEditor> => {
    const connection = await connect(uri);
    const editor = new TableEditor(panel, connection, context.extensionUri, language, queryMode, document ? {
      changed: () => documentChanged.fire({ document }),
      save: async () => { await vscode.commands.executeCommand('workbench.action.files.save'); },
      revert: async () => { await vscode.commands.executeCommand('workbench.action.files.revert'); },
      draft: document.draft
    } : undefined);
    if (document) { document.editor = editor; document.draft = undefined; }
    editors.add(editor);
    if (!queryMode) {
      const table = pendingTables.get(connection.key);
      if (table) { pendingTables.delete(connection.key); editor.selectTable(table); }
    }
    panel.onDidDispose(() => { editors.delete(editor); editor.dispose(); }, undefined, context.subscriptions);
    void reveal(connection).catch(error => output.appendLine(errorMessage(error, language)));
    return editor;
  };
  const safe = <T extends unknown[]>(action: (...args: T) => unknown) => async (...args: T): Promise<void> => {
    try { await action(...args); } catch (error) { void vscode.window.showErrorMessage(`SQLite: ${errorMessage(error, language)}`); }
  };
  const pickUri = async (resource?: vscode.Uri): Promise<vscode.Uri | undefined> => resource ?? (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { SQLite: ['db', 'sqlite', 'sqlite3'], [t.allFiles]: ['*'] } }))?.[0];
  const showTable = async (item: ExplorerItem, beside: boolean): Promise<void> => {
    if (!item?.object || item.object.type === 'index') { return; }
    const editor = [...editors].find(current => current.connection.key === item.connection.key && current.panel.viewType !== 'sqliteExplorer.query');
    if (editor) { editor.selectTable(item.object.name, beside ? vscode.ViewColumn.Beside : editor.panel.viewColumn); return; }
    pendingTables.set(item.connection.key, item.object.name);
    try {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(item.connection.key), 'sqliteExplorer.database', { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: true, preview: false });
    } catch (error) { pendingTables.delete(item.connection.key); throw error; }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('sqliteExplorer.database', {
    onDidChangeCustomDocument: documentChanged.event,
    openCustomDocument: async (uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<DatabaseDocument> => ({
      uri,
      draft: openContext.backupId ? JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId))).toString('utf8')) : undefined,
      dispose: () => undefined
    }),
    resolveCustomEditor: async (document: DatabaseDocument, panel: vscode.WebviewPanel) => { await attach(document.uri, panel, false, document); },
    saveCustomDocument: async (document: DatabaseDocument) => { await document.editor?.saveEdits(); },
    saveCustomDocumentAs: async () => { throw new AppError('saveAsUnavailable'); },
    revertCustomDocument: async (document: DatabaseDocument) => { await document.editor?.discardEdits(); },
    backupCustomDocument: async (document: DatabaseDocument, backupContext: vscode.CustomDocumentBackupContext) => {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(backupContext.destination, '..'));
      await vscode.workspace.fs.writeFile(backupContext.destination, Buffer.from(JSON.stringify(document.editor?.exportDraft() ?? document.draft ?? null), 'utf8'));
      return { id: backupContext.destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(backupContext.destination); } catch (error) { output.appendLine(errorMessage(error, language)); } } };
    }
  } satisfies vscode.CustomEditorProvider<DatabaseDocument>, { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.open', safe(async (resource?: vscode.Uri) => {
    const uri = await pickUri(resource);
    if (uri) { await vscode.commands.executeCommand('vscode.openWith', uri, 'sqliteExplorer.database', { preview: false }); }
  })));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.refresh', () => tree.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.showExplorer', safe(async () => reveal((await connections.all())[0]))));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.showTable', safe(async (item: ExplorerItem) => showTable(item, vscode.workspace.getConfiguration('sqliteExplorer').get('openTablesBeside', false)))));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.showTableBeside', safe(async (item: ExplorerItem) => showTable(item, true))));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.query', safe(async (item?: ExplorerItem) => {
    let connection = item?.connection;
    if (!connection) {
      const all = await connections.all();
      if (all.length === 1) { connection = all[0]; }
      else if (all.length > 1) { connection = (await vscode.window.showQuickPick(all.map(value => ({ label: path.basename(value.path), description: value.path, connection: value })), { title: t.sqlQuery }))?.connection; }
      else { const uri = await pickUri(); if (uri) { connection = await connect(uri); } }
    }
    if (!connection) { return; }
    const panel = vscode.window.createWebviewPanel('sqliteExplorer.query', `${t.sqlQuery} — ${path.basename(connection.path)}`, vscode.ViewColumn.Active, { retainContextWhenHidden: true });
    try { await attach(vscode.Uri.parse(connection.key), panel, true); }
    catch (error) { panel.dispose(); throw error; }
  })));
  context.subscriptions.push(vscode.commands.registerCommand('sqliteExplorer.close', safe(async (item: ExplorerItem) => {
    if (!item?.connection) { return; }
    for (const editor of [...editors]) {
      if (editor.connection.key !== item.connection.key) { continue; }
      editor.panel.reveal();
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      if (editors.has(editor)) { return; }
    }
    await connections.close(item.connection.key);
    pendingTables.delete(item.connection.key);
    await remember();
    tree.refresh();
  })));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('sqliteExplorer.language')) {
      const current = resolveLanguage(vscode.workspace.getConfiguration('sqliteExplorer').get('language', 'auto'), vscode.env.language);
      const labels = messages(current);
      void vscode.window.showInformationMessage(labels.languageReload, labels.reload).then(choice => { if (choice === labels.reload) { void vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
    }
  }));
  context.subscriptions.push({ dispose: () => { for (const editor of editors) { editor.dispose(); } } });

  // Restore connections, never SQL execution, after a window reload.
  const saved = context.workspaceState.get<string[]>('openDatabases', []);
  const restored = await Promise.allSettled(saved.map(async key => {
    const uri = vscode.Uri.parse(key);
    if (uri.scheme !== 'file') { return; }
    await connections.open(key, uri.fsPath);
  }));
  for (const result of restored) { if (result.status === 'rejected') { output.appendLine(errorMessage(result.reason, language)); } }
  if (restored.some(result => result.status === 'rejected')) { void vscode.window.showWarningMessage(t.restoreFailed); }
  tree.refresh();
}

export async function deactivate(): Promise<void> { await manager?.dispose(); manager = undefined; }
