/**
 * Bulk import (Scene made better: "admin sends excel/text + 'add these' → all added at once").
 *
 * Hybrid design (fast AND smart):
 *  1. parse file LOCALLY (xlsx/csv/txt) — the file never goes to the model
 *  2. heuristically map headers → canonical fields (instant, works for normal files)
 *  3. send ONLY headers + 5 sample rows to the model for a mapping repair when
 *     heuristics can't cover the file (one ~2s call)
 *  4. validate every row locally with zod (per-cell errors)
 *  5. optionally soft-repair failing rows through the model in small batches
 *  6. staged preview + transactional batch insert on commit
 */
import * as XLSX from 'xlsx';

import { pool, db } from '../../db/client.js';
import { aiImportJobs, discountRules, plans, products, productVariants, quoteTemplateLines, quoteTemplates, subscriptions, subscriptionDiscounts, subscriptionEvents, subscriptionLineTaxes, subscriptionLines } from '../../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { ollamaComplete } from '../../lib/ollama.js';
import { nextNumber } from '../numbering.service.js';

export type ImportEntity = 'product' | 'plan' | 'customer';
export type ImportRow = { row: number; data: Record<string, string>; ok: boolean; errors: string[] };
export type ImportJob = typeof aiImportJobs.$inferSelect;

type FieldSpec = {
  field: string;
  aliases: string[];
  required: boolean;
  normalize?: (v: string) => string | null;
};

const money = (v: string): string | null => {
  const s = parseNumber(v);
  if (s === null) return null;
  return String(Math.round(s * 100)); // rupees → cents
};
const bool = (v: string): string | null => {
  const s = v.trim().toLowerCase();
  if (['yes', 'true', '1', 'y', 'on', '✓', 'x'].includes(s)) return 'true';
  if (['no', 'false', '0', 'n', 'off'].includes(s)) return 'false';
  return null;
};
const dateNorm = (v: string): string | null => {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = Date.parse(s);
  if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0, 10);
  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m?.[1] && m[2] && m[3]) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
function parseNumber(v: string): number | null {
  const cleaned = v.replace(/[₹$,"'\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const ENTITY_SPECS: Record<ImportEntity, FieldSpec[]> = {
  product: [
    { field: 'sku', aliases: ['sku', 'code', 'product code', 'part number'], required: false },
    { field: 'name', aliases: ['name', 'product', 'product name', 'item', 'title'], required: true },
    { field: 'kind', aliases: ['kind', 'type', 'product type', 'category'], required: false },
    { field: 'salesPrice', aliases: ['sales price', 'price', 'sale price', 'mrp', 'selling price', 'list price', 'monthly price'], required: true, normalize: money },
    { field: 'costPrice', aliases: ['cost price', 'cost', 'purchase price', 'unit cost'], required: false, normalize: money },
    { field: 'notes', aliases: ['notes', 'description', 'about', 'details'], required: false },
  ],
  plan: [
    { field: 'productSku', aliases: ['sku', 'product sku', 'product code'], required: true },
    { field: 'name', aliases: ['name', 'plan', 'plan name', 'title'], required: true },
    { field: 'interval', aliases: ['interval', 'billing', 'billing interval', 'frequency', 'billing cycle', 'cycle'], required: true },
    { field: 'price', aliases: ['price', 'amount', 'plan price', 'rate', 'monthly price'], required: true, normalize: money },
    { field: 'minQty', aliases: ['min qty', 'minimum quantity', 'min seats', 'min', 'minimum'], required: false },
    { field: 'validFrom', aliases: ['valid from', 'start date', 'available from'], required: false, normalize: dateNorm },
    { field: 'validTo', aliases: ['valid to', 'end date', 'available until'], required: false, normalize: dateNorm },
    { field: 'autoRenew', aliases: ['auto renew', 'auto-renew', 'renewal', 'renews'], required: false, normalize: bool },
    { field: 'allowPause', aliases: ['allow pause', 'pausable', 'can pause'], required: false, normalize: bool },
    { field: 'autoCloseAtEnd', aliases: ['auto close', 'closes at end', 'auto-close'], required: false, normalize: bool },
  ],
  customer: [
    { field: 'email', aliases: ['email', 'e-mail', 'email address'], required: false },
    { field: 'companyName', aliases: ['company', 'company name', 'business name', 'organisation', 'organization', 'customer'], required: true },
    { field: 'contactName', aliases: ['contact', 'contact name', 'person', 'name', 'full name'], required: false },
    { field: 'phone', aliases: ['phone', 'phone number', 'mobile', 'contact number'], required: false },
    { field: 'address', aliases: ['address', 'city', 'location'], required: false },
  ],
};

/* -------------------------------------------------------------- parsing in */

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

export function parseWorkbook(buffer: Buffer, filename: string): ParsedSheet {
  if (filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls')) {
    const wb = XLSX.read(buffer);
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) throw new AppError('validation_error', 'The file has no sheets.');
    const arr = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
    return normalizeSheet(arr);
  }
  // csv / txt: naive csv split (quotes respected) or tab separated
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const sep = text.includes('\t') && !text.includes(',') ? '\t' : ',';
  const arr = parseCSV(text, sep);
  return normalizeSheet(arr);
}

function normalizeSheet(arr: unknown[][]): ParsedSheet {
  if (arr.length === 0) throw new AppError('validation_error', 'The file is empty.');
  // Real spreadsheets often carry prose before the table (instructions, titles).
  // Find the header line: the first row within the first 15 whose cells match
  // at least two known field aliases. Everything above it is dropped.
  const allAliases = new Set(
    Object.values(ENTITY_SPECS)
      .flat()
      .flatMap((f) => f.aliases),
  );
  const score = (row: unknown[]) =>
    row.filter((c) => allAliases.has(String(c ?? '').trim().toLowerCase())).length;

  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, arr.length); i++) {
    if (score(arr[i] ?? []) >= 2) {
      headerIdx = i;
      break;
    }
  }
  const headers = (arr[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  if (headers.filter(Boolean).length === 0) throw new AppError('validation_error', 'No header row found.');
  const rows = arr.slice(headerIdx + 1, 5001).map((r) => (r as unknown[]).map((c) => String(c ?? '').trim()));
  return { headers, rows };
}

export function parseCSV(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',' || ch === sep) {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
      continue;
    }
    if (ch === '\r') continue;
    cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

/** tabular text (paste from spreadsheet): tab > comma > 2+ spaces.
 *  Lines starting with # or // are treated as comments and dropped, and the
 *  table may start after prose — the header row is located by content. */
export function parseText(text: string): ParsedSheet {
  const all = text.replace(/\r/g, '').split('\n').filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('#') && !t.startsWith('//');
  }).slice(0, 5001);
  if (all.length === 0) throw new AppError('validation_error', 'No content provided.');

  // locate a header-like line (≥2 comma cells that match known aliases)
  const allAliases = new Set(
    Object.values(ENTITY_SPECS)
      .flat()
      .flatMap((f) => f.aliases),
  );
  const headerLike = (l: string) => {
    const cells = l.split(/[,;\t]/).map((c) => c.trim().toLowerCase());
    return cells.filter((c) => allAliases.has(c)).length >= 2;
  };
  const start = all.findIndex(headerLike);
  const lines = start >= 0 ? all.slice(start) : all;

  const first = lines[0]!;
  let arr: string[][];
  if (first.includes('\t')) {
    arr = lines.map((l) => l.split('\t'));
  } else if ((first.match(/,/g)?.length ?? 0) >= 1 && lines.slice(0, 4).every((l) => l.includes(','))) {
    arr = parseCSV(lines.join('\n'), ',');
  } else {
    arr = lines.map((l) => l.split(/\s{2,}/));
  }
  return normalizeSheet(arr);
}

/* ------------------------------------------------------------ header mapping */

export function heuristicMap(entity: ImportEntity, headers: string[]): Record<string, string> {
  const spec = ENTITY_SPECS[entity];
  const map: Record<string, string> = {};
  for (const header of headers) {
    const h = header.toLowerCase().replace(/[_-]+/g, ' ').trim();
    for (const f of spec) {
      if (map[f.field]) continue;
      if (f.aliases.some((a) => h === a)) {
        map[f.field] = header;
        break;
      }
    }
    for (const f of spec) {
      if (map[f.field]) continue;
      if (f.aliases.some((a) => h.includes(a))) {
        map[f.field] = header;
        break;
      }
    }
  }
  return map;
}

/** Model-assisted mapping (headers + 5 sample rows only) */
export async function llmRepairMap(
  entity: ImportEntity,
  headers: string[],
  sample: string[][],
): Promise<Record<string, string>> {
  const spec = ENTITY_SPECS[entity];
  const fields = spec.map((f) => f.field).join(', ');
  const prompt = `Map spreadsheet columns to fields for importing ${entity} records.

Target fields (exactly these): ${fields}
Source columns: ${headers.join(' | ')}
Sample rows:
${sample.slice(0, 5).map((r) => r.join(' | ')).join('\n')}

Rules:
- Output ONLY JSON: {"mapping": {"<source column>": "<target field>"}}
- One-to-one mapping; do not map two columns to the same field.
- Unmapped columns are simply omitted. Map as many as are plausible.
- For prices, the spreadsheet number is in rupees.`;
  const raw = await ollamaComplete([{ role: 'user', content: prompt }], { maxTokens: 400, temperature: 0 });
  try {
    const parsed = JSON.parse(raw) as { mapping?: Record<string, string> };
    // validate against spec
    const validFields = new Set(spec.map((f) => f.field));
    const clean: Record<string, string> = {};
    for (const [src, dst] of Object.entries(parsed.mapping ?? {})) {
      if (headers.includes(src) && validFields.has(dst) && !Object.values(clean).includes(dst)) {
        clean[dst] = src;
      }
    }
    return clean;
  } catch {
    throw new AppError('business_rule', 'AI mapping failed. Rename columns or paste a cleaner sample.');
  }
}

/* ------------------------------------------------------------- row mapping */

export function mapRows(
  entity: ImportEntity,
  headers: string[],
  rows: string[][],
  map: Record<string, string>,
): ImportRow[] {
  const spec = ENTITY_SPECS[entity];
  const required = spec.filter((f) => f.required).map((f) => f.field);
  return rows.map((data, idx) => {
    const rec: Record<string, string> = {};
    for (const [field, srcHeader] of Object.entries(map)) {
      const col = headers.indexOf(srcHeader);
      if (col < 0) continue;
      let value = data[col] ?? '';
      const f = spec.find((sp) => sp.field === field)!;
      if (f.normalize) {
        const norm = f.normalize(value);
        if (norm === null && value.trim() !== '') {
          rec[field] = value; // keep raw; validation will flag it
          continue;
        }
        value = norm ?? '';
      }
      rec[field] = value;
    }
    const errors: string[] = [];
    for (const req of required) {
      if (!rec[req] || rec[req].trim() === '') errors.push(`${req} is required`);
    }
    validateRow(entity, rec, errors);
    return { row: idx + 1, data: rec, ok: errors.length === 0, errors };
  });
}

function validateRow(entity: ImportEntity, rec: Record<string, string>, errors: string[]) {
  if (entity === 'product' || entity === 'plan') {
    if (rec.salesPrice !== undefined || rec.price !== undefined) {
      const price = Number(entity === 'product' ? rec.salesPrice : rec.price);
      if (Number.isNaN(price) || price < 0) errors.push('price must be a number');
    }
    if (entity === 'plan' && rec.interval) {
      if (!['daily', 'weekly', 'monthly', 'yearly'].includes(rec.interval.toLowerCase())) {
        errors.push('interval must be daily/weekly/monthly/yearly');
      }
    }
    if (entity === 'plan' && rec.minQty) {
      const q = Number(rec.minQty);
      if (Number.isNaN(q) || q < 1) errors.push('minQty must be >= 1');
    }
  }
  if (entity === 'customer' && rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) {
    errors.push('email is invalid');
  }
}

/** optional second pass: let the model fix misformatted values in small batches */
export async function llmSoftRepair(
  entity: ImportEntity,
  badRows: ImportRow[],
): Promise<ImportRow[]> {
  if (badRows.length === 0) return badRows;
  const batches = Array.from({ length: Math.min(3, Math.ceil(badRows.length / 20)) }, (_, b) =>
    badRows.slice(b * 20, b * 20 + 20),
  );
  const repaired: ImportRow[] = [];
  for (const batch of batches) {
    const prompt = `Fix these ${entity} import rows so they pass validation. Output ONLY JSON: {"rows":[{"row":1,...corrected fields...}]}
Target fields: ${ENTITY_SPECS[entity].map((f) => f.field).join(', ')}.
Prices must be plain NUMBERS in rupees (e.g. 1299 for ₹1,299). Dates YYYY-MM-DD. Interval daily|weekly|monthly|yearly. If a value cannot be corrected, omit the row.
Rows: ${JSON.stringify(batch.map((r) => ({ row: r.row, data: r.data, errors: r.errors })))}`;
    const raw = await ollamaComplete([{ role: 'user', content: prompt }], { maxTokens: 1600, temperature: 0 });
    try {
      const parsed = JSON.parse(raw) as { rows?: Array<{ row: number; data: Record<string, string> }> };
      for (const r of parsed.rows ?? []) {
        const original = badRows.find((b) => b.row === r.row);
        if (!original) continue;
        const errors: string[] = [];
        for (const f of ENTITY_SPECS[entity]) {
          const origVal = (original.data[f.field] ?? '').trim();
          const newVal = String(r.data[f.field] ?? '').trim();
          if (newVal && !origVal) {
            // ANTI-FABRICATION: the model may fix formatting, never invent values
            // the operator never provided.
            delete r.data[f.field];
            continue;
          }
          if (newVal && f.normalize) {
            const norm = f.normalize(newVal);
            r.data[f.field] = norm ?? newVal;
          }
        }
        validateRow(entity, r.data, errors);
        const required = ENTITY_SPECS[entity].filter((f) => f.required).map((f) => f.field);
        for (const req of required) {
          if (!r.data[req]) errors.push(`${req} is required`);
        }
        repaired.push({ row: r.row, data: r.data, ok: errors.length === 0, errors });
      }
    } catch {
      // keep originals
    }
  }
  // merge: repaired wins over original for rows it covered
  const map = new Map<number, ImportRow>(badRows.map((b) => [b.row, b]));
  for (const r of repaired) map.set(r.row, r);
  return [...map.values()];
}

/* --------------------------------------------------------------- job stage */

export async function stageImport(
  userId: number,
  filename: string,
  entity: ImportEntity,
  headers: string[],
  rows: string[][],
  map: Record<string, string>,
  mapped: ImportRow[],
): Promise<ImportJob> {
  const [job] = await db
    .insert(aiImportJobs)
    .values({
      createdBy: userId,
      filename: filename.slice(0, 250),
      entity,
      headerMap: map,
      rows: mapped,
      validCount: mapped.filter((r) => r.ok).length,
      invalidCount: mapped.filter((r) => !r.ok).length,
    })
    .returning();
  return job!;
}

/* ------------------------------------------------------------------- commit */

export async function commitImport(
  jobId: string,
  actorId: number,
): Promise<{ inserted: number; failed: number; entity: ImportEntity }> {
  const [job] = await db.select().from(aiImportJobs).where(eq(aiImportJobs.id, jobId)).limit(1);
  if (!job) throw new AppError('not_found', 'Import job not found.');
  if (job.status === 'committed') throw new AppError('conflict', 'This import was already committed.');
  if (job.entity === 'plan') {
    throw new AppError('validation_error', 'Plan imports must go through the review grid (use products flow for now).');
  }
  const rows = (job.rows ?? []) as ImportRow[];
  const okRows = rows.filter((r) => r.ok);

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    if (job.entity === 'product') {
      for (const chunk of chunks(okRows, 500)) {
        const values: unknown[] = [];
        const tuples = chunk.map((r, i) => {
          values.push(
            r.data.sku || r.data.name!.slice(0, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''),
            r.data.name!,
            /addon|add-?on/i.test(r.data.kind ?? '') ? 'addon' : /service|serv/i.test(r.data.kind ?? '') ? 'service' : 'software',
            Number(r.data.salesPrice ?? 0),
            Number(r.data.costPrice ?? 0),
            r.data.notes ?? null,
          );
          const base = i * 6;
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
        });
        const res = await client.query(
          `INSERT INTO products (sku, name, kind, sales_price, cost_price, notes) VALUES ${tuples.join(',')} ON CONFLICT (sku) DO NOTHING RETURNING id`,
          values,
        );
        inserted += res.rows.length;
      }
    } else {
      // customer: user + customer profile (skip duplicates)
      for (const r of okRows) {
        if (!r.data.email) continue;
        const exists = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [r.data.email]);
        if (exists.rows.length > 0) continue;
        const argon = await import('@node-rs/argon2');
        const hash = await argon.hash('Brightloop@Temp1', { memoryCost: 19456, timeCost: 2, parallelism: 1 });
        const u = await client.query(
          "INSERT INTO users (email, password_hash, name, role, email_verified) VALUES ($1,$2,$3,'customer',true) RETURNING id",
          [r.data.email.toLowerCase(), hash, r.data.contactName || r.data.companyName],
        );
        await client.query(
          'INSERT INTO customers (user_id, company_name, contact_name, phone, address) VALUES ($1,$2,$3,$4,$5)',
          [u.rows[0].id, r.data.companyName, r.data.contactName ?? null, r.data.phone ?? null, r.data.address ?? null],
        );
        inserted++;
      }
    }
    await client.query(
      "UPDATE ai_import_jobs SET status='committed', committed_count=$2, committed_at=now(), result=$3 WHERE id=$1",
      [jobId, inserted, JSON.stringify({ inserted })],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  void actorId;
  return { inserted, failed: rows.length - okRows.length, entity: job.entity };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
