import { authenticate } from "../shopify.server";
import { suggestKeywords } from "../lib/anthropic.server";
import { fetchAllProductTags } from "../lib/inventory.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const data = await request.formData();
  const description = String(data.get("description") || "").trim();

  if (!description) {
    return Response.json({ error: "Description is required" }, { status: 400 });
  }

  try {
    // Pull existing product tags so the model prefers vocabulary that's
    // actually in the catalog. Failure here is non-fatal — just suggest
    // without a vocabulary hint.
    const vocabulary = await fetchAllProductTags(admin).catch(() => []);
    const keywords = await suggestKeywords({ description, vocabulary });
    return Response.json({ keywords });
  } catch (err) {
    console.error("Keyword suggestion failed:", err);
    return Response.json(
      { error: err.message || "Failed to suggest keywords" },
      { status: 500 },
    );
  }
};
