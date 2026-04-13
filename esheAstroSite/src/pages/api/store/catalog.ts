import type { APIRoute } from "astro";
import { SquareClient, SquareEnvironment } from "square";
import type * as Square from "square";

export const prerender = false;

function getSquareClient() {
  return new SquareClient({
    token: import.meta.env.SQUARE_ACCESS_TOKEN,
    environment: import.meta.env.SQUARE_ENV === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}


// Helper to safely stringify objects with BigInt values
function safeStringify(obj: any) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
    2
  );
}

export const GET: APIRoute = async () => {
  try {
    console.log("[Catalog API] Handler invoked");
    const locationId = import.meta.env.SQUARE_LOCATION_ID;
    console.log("[Catalog API] SQUARE_LOCATION_ID:", locationId);
    if (!locationId) {
      console.error("[Catalog API] Missing SQUARE_LOCATION_ID");
      return new Response(
        JSON.stringify({ error: "Missing SQUARE_LOCATION_ID" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const square = getSquareClient();
    console.log("[Catalog API] Square client created");

    // Use search to get items with related objects
    const catalogRes = await square.catalog.search({
      objectTypes: ["ITEM"],
      includeRelatedObjects: true,
    });
    console.log("[Catalog API] catalogRes:", safeStringify(catalogRes));

    const objects = catalogRes.objects ?? [];
    const related = catalogRes.relatedObjects ?? [];
    console.log(`[Catalog API] Found ${objects.length} items, ${related.length} related objects`);

    const categoriesById = new Map<string, { id: string; name: string; slug: string }>();
    const imageUrlById = new Map<string, string>();

    for (const obj of related) {
      if (obj.type === "CATEGORY" && obj.id && (obj as any).categoryData?.name) {
        const name = (obj as any).categoryData.name as string;
        categoriesById.set(obj.id, {
          id: obj.id,
          name,
          slug: slugify(name),
        });
      }
      if (obj.type === "IMAGE" && obj.id && (obj as any).imageData?.url) {
        imageUrlById.set(obj.id, (obj as any).imageData.url as string);
      }
    }
    console.log(`[Catalog API] categoriesById:`, Array.from(categoriesById.values()));
    console.log(`[Catalog API] imageUrlById:`, Array.from(imageUrlById.entries()));

    const products = [];
    const allVariationIds: string[] = [];

    for (const item of objects) {
      if (item.type !== "ITEM" || !item.id || !(item as any).itemData) continue;

      const itemData = (item as any).itemData as Square.CatalogItem;
      const categoryId = itemData.categoryId ?? "uncategorized";
      const category = categoriesById.get(categoryId) ?? {
        id: "uncategorized",
        name: "Uncategorized",
        slug: "uncategorized",
      };

      const imageId = itemData.imageIds?.[0];
      const imageUrl = imageId ? imageUrlById.get(imageId) ?? null : null;

      const variations = (itemData.variations ?? [])
        .filter((v): v is Square.CatalogObject.ItemVariation =>
          (v as any).type === "ITEM_VARIATION" && !!(v as any).itemVariationData && !!(v as any).itemVariationData.priceMoney?.amount
        )
        .map((v) => {
          const varData = (v as any).itemVariationData as Square.CatalogItemVariation;
          allVariationIds.push(v.id!);
          return {
            variationId: v.id!,
            name: varData.name ?? "Default",
            priceCents: Number(varData.priceMoney?.amount ?? 0),
            currency: varData.priceMoney?.currency ?? "USD",
          };
        });

      if (variations.length === 0) continue;

      products.push({
        itemId: item.id,
        name: itemData.name ?? "Unnamed Item",
        description: itemData.description ?? "",
        categoryId: category.id,
        categorySlug: category.slug,
        imageUrl,
        variations,
      });
    }
    console.log(`[Catalog API] products:`, products);
    console.log(`[Catalog API] allVariationIds:`, allVariationIds);

    const invRes = await square.inventory.batchGetCounts({
      catalogObjectIds: allVariationIds,
      locationIds: [locationId],
    });
    console.log(`[Catalog API] invRes:`, safeStringify(invRes));

    const counts = new Map<string, number>();
    // batchGetCounts returns a pager; use its data array for the current page
    const invData = invRes.data ?? [];
    for (const c of invData) {
      const id = c.catalogObjectId;
      if (!id) continue;
      counts.set(id, Number(c.quantity ?? "0"));
    }
    console.log(`[Catalog API] counts:`, Array.from(counts.entries()));

    const hydratedProducts = products.map((p) => ({
      ...p,
      variations: p.variations.map((v) => {
        const available = Math.max(0, counts.get(v.variationId) ?? 0);
        return { ...v, available, inStock: available > 0 };
      }),
    }));
    console.log(`[Catalog API] hydratedProducts:`, hydratedProducts);

    const categoryMap = new Map<string, { id: string; slug: string; name: string }>();
    for (const p of hydratedProducts) {
      if (!categoryMap.has(p.categoryId)) {
        categoryMap.set(p.categoryId, {
          id: p.categoryId,
          slug: p.categorySlug,
          name: categoriesById.get(p.categoryId)?.name ?? "Uncategorized",
        });
      }
    }
    console.log(`[Catalog API] categoryMap:`, Array.from(categoryMap.values()));

    return new Response(
      JSON.stringify({
        categories: [...categoryMap.values()],
        products: hydratedProducts,
        updatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Catalog API] Catalog fetch error:", err, err?.stack);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Catalog fetch failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
