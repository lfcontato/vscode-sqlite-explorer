import { createHash } from 'node:crypto';
import { Row, RowSnapshot } from '../domain/database';

/** Hash native values before BLOB preview conversion; all row fields participate in conflict detection. */
export function snapshotRow(native: Record<string, unknown>): { row: Row; snapshot: RowSnapshot } {
  const hash = createHash('sha256');
  const row: Row = Object.create(null) as Row;
  const snapshot: RowSnapshot = { fingerprint: '', types: Object.create(null), safe: true };
  for (const [column, value] of Object.entries(native)) {
    const type = Buffer.isBuffer(value) ? 'blob' : value === null ? 'null' : typeof value === 'number' ? 'number' : 'text';
    snapshot.types[column] = type;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
    hash.update(JSON.stringify([column, type, bytes.length])); hash.update(bytes);
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) { snapshot.safe = false; }
    if (typeof value === 'string' && value.length > 65_536) { snapshot.safe = false; }
    row[column] = Buffer.isBuffer(value) ? `BLOB (${value.length} bytes): ${value.subarray(0, 128).toString('hex')}${value.length > 128 ? '…' : ''}` : value === null ? null : typeof value === 'number' ? value : String(value);
  }
  snapshot.fingerprint = hash.digest('hex');
  return { row, snapshot };
}
