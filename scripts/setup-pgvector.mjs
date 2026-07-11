import { config } from "dotenv"; config();
import pkg from "pg"; const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const run = async (label, sql) => { const t=Date.now(); await db.query(sql); console.log(`✓ ${label} (${Date.now()-t}ms)`); };

await run("enable pgvector", `CREATE EXTENSION IF NOT EXISTS vector`);
await run("add vec column", `ALTER TABLE "ProductEmbedding" ADD COLUMN IF NOT EXISTS vec vector(1024)`);
await run("backfill vec from embedding", `UPDATE "ProductEmbedding" SET vec = (embedding::text)::vector WHERE vec IS NULL AND embedding IS NOT NULL`);
await run("trigger fn", `
  CREATE OR REPLACE FUNCTION sync_embedding_vec() RETURNS trigger AS $$
  BEGIN
    IF NEW.embedding IS NOT NULL THEN NEW.vec := (NEW.embedding::text)::vector; END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql`);
await run("trigger", `
  DROP TRIGGER IF EXISTS trg_sync_vec ON "ProductEmbedding";
  CREATE TRIGGER trg_sync_vec BEFORE INSERT OR UPDATE OF embedding ON "ProductEmbedding"
  FOR EACH ROW EXECUTE FUNCTION sync_embedding_vec()`);
await run("hnsw index", `CREATE INDEX IF NOT EXISTS productembedding_vec_hnsw ON "ProductEmbedding" USING hnsw (vec vector_cosine_ops)`);

const c = (await db.query(`SELECT COUNT(*)::int n, COUNT(vec)::int v FROM "ProductEmbedding"`)).rows[0];
console.log(`rows=${c.n} withVec=${c.v}`);
// sanity: top-5 nearest to the first row's own vector (should include itself at distance 0)
const sample = (await db.query(`SELECT vec::text v FROM "ProductEmbedding" WHERE vec IS NOT NULL LIMIT 1`)).rows[0].v;
const top = await db.query(`SELECT title, 1-(vec <=> $1::vector) sim FROM "ProductEmbedding" WHERE vec IS NOT NULL ORDER BY vec <=> $1::vector LIMIT 3`, [sample]);
console.log("top-3 self-similarity check:"); top.rows.forEach(r=>console.log(`  ${r.sim.toFixed(3)}  ${r.title?.slice(0,50)}`));
await db.end();
