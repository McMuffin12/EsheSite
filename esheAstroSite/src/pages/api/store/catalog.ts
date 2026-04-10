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

export const GET: APIRoute = async () => {
  try {
    const locationId = import.meta.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      return new Response(
        JSON.stringify({ error: "Missing SQUARE_LOCATION_ID" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const square = getSquareClient();

    // Use search to get items with related objects
    const catalogRes = await square.catalog.search({
      objectTypes: ["ITEM"],
      includeRelatedObjects: true,
    });

    const objects = catalogRes.objects ?? [];
    const related = catalogRes.relatedObjects ?? [];

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

    const invRes = await square.inventory.batchGetCounts({
      catalogObjectIds: allVariationIds,
      locationIds: [locationId],
    });

    const counts = new Map<string, number>();
    // batchGetCounts returns a pager; use its data array for the current page
    const invData = invRes.data ?? [];
    for (const c of invData) {
      const id = c.catalogObjectId;
      if (!id) continue;
      counts.set(id, Number(c.quantity ?? "0"));
    }

    const hydratedProducts = products.map((p) => ({
      ...p,
      variations: p.variations.map((v) => {
        const available = Math.max(0, counts.get(v.variationId) ?? 0);
        return { ...v, available, inStock: available > 0 };
      }),
    }));

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

    return new Response(
      JSON.stringify({
        categories: [...categoryMap.values()],
        products: hydratedProducts,
        updatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Catalog fetch error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Catalog fetch failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
