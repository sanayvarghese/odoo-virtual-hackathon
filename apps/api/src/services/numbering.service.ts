/** Atomic document numbering: SUB-2025-00001 / INV-2025-00001 (safe under concurrency) */
import { pool } from '../db/client.js';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export async function nextNumber(entity: 'subscription' | 'invoice'): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await pool.query<{ last: number }>(
    `INSERT INTO numberings(entity, year, last)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity, year) DO UPDATE SET last = numberings.last + 1
     RETURNING last`,
    [entity, year],
  );
  const last = rows[0]?.last ?? 1;
  const prefix = entity === 'subscription' ? 'SUB' : 'INV';
  return `${prefix}-${year}-${pad(last, 6)}`;
}
