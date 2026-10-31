/**
 * Applies the reporting SQL views + extra indexes (idempotent).
 * Run: npm run db:views
 *	found via drizzle.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const views = [
  { file: 'views.sql' },
];

const main = async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  for (const { file } of views) {
    const sql = fs.readFileSync(path.join(here, file), 'utf8');
    await pool.query(sql);
    console.log(`✓ applied ${file}`);
  }
  await pool.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
