const PRODUCTS_QUERY = `#graphql
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
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

export async function fetchAllProductTags(admin) {
  const tags = new Set();
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { cursor } });
    const json = await response.json();
    const page = json.data.products;

    for (const { node } of page.edges) {
      node.tags.forEach((t) => tags.add(t.toLowerCase().trim()));
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return [...tags].sort();
}
