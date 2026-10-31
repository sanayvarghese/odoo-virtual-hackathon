// Creates the brightloop database if it doesn't exist.
// Postgres has no "CREATE DATABASE IF NOT EXISTS", so we inspect pg_database first.
// Usage: node scripts/create-db.mjs      (run from apps/api)
import pg from 'pg';
import { config } from 'dotenv';

config();

const url = process.env.DATABASE_URL ?? 'postgres://postgres:root@localhost:5432/brightloop';
const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '') || 'brightloop';

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (rows.length === 0) {
  await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8'`);
  console.log(`✓ database "${dbName}" created`);
} else {
  console.log(`✓ database "${dbName}" already exists`);
}
await client.end();
