import { Cell, Result, RowChange, WriteResult } from './database';
import { AppError } from './errors';

interface CellEdit { row: number; column: string; before: Cell; after: Cell }
export interface EditDraft { base: Result; commands: CellEdit[]; cursor: number }

/** Command history for one page. No editor API, SQL, filesystem, or write side effects. */
export class EditSession {
  private readonly base: Result;
  private current: Result;
  private commands: CellEdit[] = [];
  private cursor = 0;
  constructor(result: Result) { this.base = structuredClone(result); this.current = structuredClone(result); }
  get result(): Result { return structuredClone(this.current); }
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.commands.length; }
  get dirtyCount(): number {
    return this.current.rows.reduce((count, row, index) => count + Object.keys(row).filter(column => row[column] !== this.base.rows[index]?.[column]).length, 0);
  }
  canEdit(row: number, column: string): boolean {
    const info = this.base.editing;
    const snapshot = this.base.snapshots?.[row];
    const record = this.base.rows[row];
    return Boolean(info && snapshot?.safe && record && info.columns.includes(column) && snapshot.types[column] !== 'blob' && info.primaryKeys.every(key => record[key] !== null && record[key] !== undefined));
  }
  edit(row: number, column: string, value: Cell): void {
    if (!this.canEdit(row, column) || !isCell(value) || this.cursor >= 1000) { throw new AppError('invalidEdit'); }
    const before = this.current.rows[row]![column]!;
    if (before === value) { return; }
    this.commands.splice(this.cursor);
    this.commands.push({ row, column, before, after: value }); this.cursor++;
    this.current.rows[row]![column] = value;
  }
  undo(): void { if (this.canUndo) { const command = this.commands[--this.cursor]!; this.current.rows[command.row]![command.column] = command.before; } }
  redo(): void { if (this.canRedo) { const command = this.commands[this.cursor++]!; this.current.rows[command.row]![command.column] = command.after; } }
  discard(): void { this.current = structuredClone(this.base); this.commands = []; this.cursor = 0; }
  changes(): RowChange[] {
    const info = this.base.editing;
    if (!info) { return []; }
    return this.current.rows.flatMap((row, index) => {
      const values = Object.fromEntries(Object.entries(row).filter(([column, value]) => value !== this.base.rows[index]?.[column]));
      return Object.keys(values).length ? [{ table: info.table, schemaSql: info.schemaSql, primaryKeys: [...info.primaryKeys], key: info.primaryKeys.map(key => this.base.rows[index]![key]!), fingerprint: this.base.snapshots![index]!.fingerprint, values }] : [];
    });
  }
  /** Commit acknowledges native values (including SQLite affinity and trigger changes). History ends at Save. */
  commit(saved: WriteResult): void {
    const changes = this.changes();
    if (changes.length !== saved.rows.length) { throw new AppError('invalidEdit'); }
    let changed = 0;
    for (let index = 0; index < this.current.rows.length; index++) {
      if (Object.keys(this.current.rows[index]!).some(column => this.current.rows[index]![column] !== this.base.rows[index]![column])) {
        const value = saved.rows[changed++]!;
        this.base.rows[index] = value.row;
        this.base.snapshots![index] = value.snapshot;
      }
    }
    this.discard();
  }
  toJSON(): EditDraft { return { base: structuredClone(this.base), commands: structuredClone(this.commands), cursor: this.cursor }; }
  static restore(raw: unknown): EditSession {
    if (!raw || typeof raw !== 'object' || Buffer.byteLength(JSON.stringify(raw)) > 16 * 1024 * 1024) { throw new AppError('invalidEdit'); }
    const state = raw as EditDraft;
    const base = state.base;
    if (!base || !Array.isArray(base.columns) || base.columns.some(c => typeof c !== 'string') || !Array.isArray(base.rows) || base.rows.length > 100 || !base.rows.every(row => row && typeof row === 'object' && base.columns.every(column => Object.hasOwn(row, column) && isCell(row[column])))) { throw new AppError('invalidEdit'); }
    const info = base.editing;
    if (!info || typeof info.table !== 'string' || typeof info.schemaSql !== 'string' || !Array.isArray(info.columns) || !Array.isArray(info.primaryKeys) || !info.primaryKeys.length || [...info.columns, ...info.primaryKeys].some(name => typeof name !== 'string' || !base.columns.includes(name)) || !Array.isArray(base.snapshots) || base.snapshots.length !== base.rows.length || base.snapshots.some(snapshot => !snapshot || typeof snapshot.safe !== 'boolean' || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint) || !snapshot.types || base.columns.some(column => !['text', 'number', 'null', 'blob'].includes(snapshot.types[column]!)))) { throw new AppError('invalidEdit'); }
    if (!Array.isArray(state.commands) || state.commands.length > 1000 || !Number.isInteger(state.cursor) || state.cursor < 0 || state.cursor > state.commands.length) { throw new AppError('invalidEdit'); }
    const session = new EditSession(base);
    for (const command of state.commands) {
      if (!command || !Number.isInteger(command.row) || typeof command.column !== 'string') { throw new AppError('invalidEdit'); }
      session.edit(command.row, command.column, command.after);
    }
    while (session.cursor > state.cursor) { session.undo(); }
    return session;
  }
}

export function isCell(value: unknown): value is Cell {
  return value === null || (typeof value === 'string' && value.length <= 65_536) || (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
}
