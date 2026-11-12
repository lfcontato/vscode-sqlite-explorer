import { AppError } from '../domain/errors';
import { Column, Database, DatabaseWriter, RowChange, PageRequest, PAGE_SIZE, quoteIdentifier, Result, SchemaObject, WriteResult } from '../domain/database';
import { validateReadOnlySql } from '../domain/readOnlySql';

/** Application service: schema validation and parameterized browsing rules. */
export class DatabaseService {
  constructor(private readonly database: Database, private readonly writer?: DatabaseWriter) {}

  async schema(): Promise<SchemaObject[]> {
    const result = await this.database.query("SELECT name, type, tbl_name, sql FROM sqlite_schema WHERE type IN ('table','view','index') AND name NOT GLOB 'sqlite_*' ORDER BY type, name");
    if (result.truncated) { throw new AppError('schemaTooLarge'); }
    return result.rows as unknown as SchemaObject[];
  }

  async columns(table: string): Promise<Column[]> {
    const result = await this.database.query('SELECT name, type, pk, "notnull", hidden FROM pragma_table_xinfo(?) ORDER BY cid', [table]);
    if (result.truncated) { throw new AppError('columnsTooLarge'); }
    return result.rows as unknown as Column[];
  }

  async page(request: PageRequest): Promise<Result> {
    if (!Number.isSafeInteger(request.page) || request.page < 0 || request.page > 1_000_000) { throw new AppError('invalidPage'); }
    const object = (await this.schema()).find(item => item.name === request.table && item.type !== 'index');
    if (!object) { throw new AppError('tableMissing'); }
    const columns = await this.columns(request.table);
    if (request.sort && !columns.some(column => column.name === request.sort)) { throw new AppError('invalidSort'); }
    const parameters: unknown[] = [];
    const where = request.filter ? ` WHERE ${columns.map(column => {
      parameters.push(`%${request.filter.replace(/[\\%_]/g, '\\$&')}%`);
      return `CAST(${quoteIdentifier(column.name)} AS TEXT) LIKE ? ESCAPE '\\'`;
    }).join(' OR ')}` : '';
    const primaryKey = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const order = request.sort ? [request.sort, ...primaryKey.filter(name => name !== request.sort)] : primaryKey;
    // All columns provide deterministic default ordering for views / tables without a primary key.
    const sortColumns = order.length ? order : columns.map(column => column.name);
    const orderBy = sortColumns.length ? ` ORDER BY ${sortColumns.map(name => `${quoteIdentifier(name)} ${request.descending ? 'DESC' : 'ASC'}`).join(', ')}` : '';
    parameters.push(PAGE_SIZE + 1, request.page * PAGE_SIZE);
    const result = await this.database.query(`SELECT * FROM ${quoteIdentifier(request.table)}${where}${orderBy} LIMIT ? OFFSET ?`, parameters, PAGE_SIZE);
    // Fetch one extra row in SQL to determine whether a subsequent page exists.
    const editable = columns.filter(column => !column.pk && !column.hidden && !/BLOB/i.test(column.type)).map(column => column.name);
    return { ...result, columns: columns.map(column => column.name), editing: this.writer && object.type === 'table' && primaryKey.length && editable.length && object.sql ? { table: request.table, primaryKeys: primaryKey, columns: editable, schemaSql: object.sql } : undefined };
  }

  async execute(sql: string): Promise<Result> {
    validateReadOnlySql(sql);
    return this.database.query(sql);
  }
  save(changes: RowChange[]): Promise<WriteResult> {
    if (!this.writer) { return Promise.reject(new AppError('editingUnavailable')); }
    return this.writer.save(changes);
  }
  close(): Promise<void> { return this.database.close(); }
}
