import pkg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createRequire } from "module";

// @prisma/client@6.x exports wasm.mjs for ESM but only ships wasm.js.
// Use createRequire to load the CJS version, which works on all architectures
// including ARM64 Windows (no native binary needed when using driver adapters).
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client/wasm");

const { Pool } = pkg;

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
