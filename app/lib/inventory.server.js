const PRODUCTS_QUERY = `#graphql
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          productType
          vendor
          tags
          totalInventory
          priceRangeV2 { minVariantPrice { amount } }
          featuredImage { url }
        }
      }
    }
  }
`;

export async function fetchInStockProducts(admin) {
  const products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { cursor } });
    const json = await response.json();
    const page = json.data.products;

    for (const { node } of page.edges) {
      if (node.totalInventory > 0) {
        const amount = node.priceRangeV2?.minVariantPrice?.amount;
        products.push({
          id: node.id,
          title: node.title,
          productType: node.productType || "",
          vendor: node.vendor || "",
          tags: node.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
          price: amount != null ? parseFloat(amount) : null,
          image: node.featuredImage?.url || null,
        });
      }
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return products;
}

const PRODUCT_TAGS_QUERY = `#graphql
  query GetProductTags($cursor: String) {
    productTags(first: 250, after: $cursor) {
      nodes
      pageInfo { hasNextPage endCursor }
    }
  }
`;

import { isJunkTag } from "./tagTiers.js";

// A tag is meaningful if it isn't operational noise (batch codes, intake dates,
// offers, style/seller codes, bare numbers). Junk classification lives in
// tagTiers so the vocabulary, the AI tagger, and the matcher all agree.
export function isMeaningfulTag(tag) {
  return !isJunkTag(tag);
}

// Returns the live, distinct list of *meaningful* product tags from the store,
// preserving each tag's original spelling/casing (deduped case-insensitively).
// The keyword matcher is case-insensitive, so keeping real casing here lets the
// AI tagger return tags like "Tiffany & Co." instead of a flattened version.
//
// Uses the shop-level `productTags` connection instead of paginating every
// product — the old approach walked the entire catalog on every "Suggest
// keywords" click and timed out the 30s serverless function.
export async function fetchAllProductTags(admin) {
  const byLower = new Map(); // lowercase -> first-seen original casing
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCT_TAGS_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();
    const page = json.data.productTags;

    for (const tag of page.nodes) {
      const trimmed = String(tag).trim();
      if (!trimmed || !isMeaningfulTag(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, trimmed);
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}
