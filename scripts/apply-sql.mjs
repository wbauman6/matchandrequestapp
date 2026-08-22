/**
 * Apply a raw SQL file to the database.
 *
 * The migrations in prisma/migrations are drifted from schema.prisma (later
 * changes were applied with `prisma db push`), so schema changes ship as
 * idempotent scripts under scripts/sql/ and are applied with this. Unlike
 * `prisma db push` it can only do what the file says — it will never decide to
 * drop a column to reconcile drift.
 *
 *   node scripts/apply-sql.mjs scripts/sql/2026-08-customer-requests.sql
 */
import { config } from "dotenv";
config();
import { readFile } from "node:fs/promises";
import pkg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/apply-sql.mjs <path-to-.sql>");
  process.exit(1);
}

const sql = await readFile(file, "utf8");
const { Client } = pkg;
const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });

await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end();
}
