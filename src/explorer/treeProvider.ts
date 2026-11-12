import * as vscode from 'vscode';
import * as path from 'node:path';
import { Connection, ConnectionManager } from '../application/connectionManager';
import { SchemaObject } from '../domain/database';
import { Language, messages, errorMessage } from '../localization';

export class ExplorerItem extends vscode.TreeItem {
  constructor(label: string, readonly kind: 'database' | 'group' | 'object' | 'column', readonly connection: Connection, readonly object?: SchemaObject, readonly group?: string, readonly parent?: ExplorerItem, language: Language = 'en') {
    super(label, kind === 'column' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = kind === 'object' && object?.type !== 'index' ? 'table' : kind;
    this.id = JSON.stringify([connection.key, kind, group, object?.name, label, parent?.id]);
    this.iconPath = new vscode.ThemeIcon(kind === 'database' ? 'database' : kind === 'group' ? 'folder' : kind === 'column' ? 'symbol-field' : object?.type === 'index' ? 'list-ordered' : 'table');
    if (kind === 'database') { this.tooltip = connection.path; this.description = messages(language).readOnly; this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; }
    if (kind === 'group' && group === 'table') { this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; }
    if (kind === 'object' && object?.type !== 'index') {
      this.command = { command: 'sqliteExplorer.showTable', title: messages(language).viewTable, arguments: [this] };
    }
    if (object?.type === 'index') { this.collapsibleState = vscode.TreeItemCollapsibleState.None; this.description = object.tbl_name; }
    if (object?.sql) { this.tooltip = object.sql; }
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<ExplorerItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExplorerItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly manager: ConnectionManager, private readonly language: Language = 'en') {}
  refresh(): void { this.changed.fire(undefined); }
  getTreeItem(item: ExplorerItem): vscode.TreeItem { return item; }
  getParent(item: ExplorerItem): ExplorerItem | undefined { return item.parent; }
  async getChildren(item?: ExplorerItem): Promise<ExplorerItem[]> {
    try { return await this.children(item); }
    catch (error) { throw new Error(errorMessage(error, this.language)); }
  }
  private async children(item?: ExplorerItem): Promise<ExplorerItem[]> {
    if (!item) { return (await this.manager.all()).map(connection => new ExplorerItem(path.basename(connection.path), 'database', connection, undefined, undefined, undefined, this.language)); }
    const { connection } = item;
    if (item.kind === 'database') {
      const t = messages(this.language);
      return [[t.tables, 'table'], [t.views, 'view'], [t.indexes, 'index']].map(([label, group]) => new ExplorerItem(label!, 'group', connection, undefined, group, item, this.language));
    }
    if (item.kind === 'group') {
      return (await connection.service.schema()).filter(object => object.type === item.group).map(object => new ExplorerItem(object.name, 'object', connection, object, undefined, item, this.language));
    }
    if (item.kind === 'object' && item.object) {
      const table = item.object.type === 'index' ? item.object.tbl_name : item.object.name;
      return (await connection.service.columns(table)).map(column => {
        const node = new ExplorerItem(column.name, 'column', connection, undefined, undefined, item, this.language);
        node.description = `${column.type || 'ANY'}${column.pk ? ' · PK' : ''}${column.notnull ? ' · NOT NULL' : ''}`;
        return node;
      });
    }
    return [];
  }
  dispose(): void { this.changed.dispose(); }
}
