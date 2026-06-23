import prisma from "../db.server.js";

// Per-shop matching configuration. Returns the row (creating it with defaults
// the first time). Defaults mirror the historical hard-coded thresholds.
export async function getShopConfig(shop) {
  return prisma.shopConfig.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

export async function updateShopConfig(shop, data) {
  return prisma.shopConfig.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}
