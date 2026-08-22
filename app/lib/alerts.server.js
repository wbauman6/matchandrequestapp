import prisma from "../db.server.js";

/**
 * Who gets operational alerts for a shop: active admin salespeople, plus
 * ALERT_EMAIL if set. Shared by the weekly-drop failure alert and the
 * customer-request daily-cap alert.
 */
export async function alertRecipients(shop) {
  const admins = await prisma.salesperson.findMany({
    where: { shop, role: "admin", active: true },
    select: { email: true },
  });
  const list = admins.map((a) => a.email);
  if (process.env.ALERT_EMAIL) list.push(process.env.ALERT_EMAIL);
  return [...new Set(list.filter(Boolean))];
}
