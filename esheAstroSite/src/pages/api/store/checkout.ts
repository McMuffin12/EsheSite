import type { APIRoute } from "astro";
import { SquareClient, SquareEnvironment } from "square";
import type * as Square from "square";
import { randomUUID } from "crypto";
import {
  CURRENCY,
  FREE_SHIPPING_THRESHOLD_CENTS,
  SHIPPING_FEE_CENTS,
} from "../../../lib/store/shipping";

export const prerender = false;

interface CartItem {
  itemId: string;
  variationId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface ShippingInfo {
  fullName: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes?: string;
}

function getSquareClient() {
  return new SquareClient({
    token: import.meta.env.SQUARE_ACCESS_TOKEN,
    environment:
      import.meta.env.SQUARE_ENV === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function calculateShipping(subtotalCents: number) {
  const shippingCents = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_CENTS;
  return {
    shippingCents,
    isFreeShipping: shippingCents === 0,
  };
}

function toBigIntAmount(cents: number): bigint {
  return BigInt(Math.round(cents));
}

async function getInventoryCounts(
  square: SquareClient,
  locationId: string,
  variationIds: string[]
) {
  const counts = new Map<string, number>();
  if (!variationIds.length) return counts;

  const invRes = await square.inventory.batchGetCounts({
    catalogObjectIds: variationIds,
    locationIds: [locationId],
  });

  for (const count of invRes.data ?? []) {
    const id = count.catalogObjectId;
    if (!id) continue;
    counts.set(id, Number(count.quantity ?? "0"));
  }

  return counts;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const cartItems = Array.isArray(body?.cartItems) ? (body.cartItems as CartItem[]) : [];
    const shipping = body?.shipping as ShippingInfo | undefined;

    if (!cartItems.length) {
      return new Response(JSON.stringify({ error: "Cart is empty." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (
      !shipping ||
      !isNonEmpty(shipping.fullName) ||
      !isNonEmpty(shipping.phone) ||
      !isNonEmpty(shipping.address1) ||
      !isNonEmpty(shipping.city) ||
      !isNonEmpty(shipping.state) ||
      !isNonEmpty(shipping.postalCode)
    ) {
      return new Response(JSON.stringify({ error: "Shipping details are incomplete." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const locationId = import.meta.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      return new Response(JSON.stringify({ error: "Missing Square location ID." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const square = getSquareClient();

    const requestedByVariation = new Map<
      string,
      {
        quantity: number;
        name: string;
      }
    >();

    for (const item of cartItems) {
      const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (!item.variationId || quantity === 0) continue;
      const current = requestedByVariation.get(item.variationId);
      requestedByVariation.set(item.variationId, {
        quantity: (current?.quantity ?? 0) + quantity,
        name: item.name,
      });
    }

    const variationIds = Array.from(requestedByVariation.keys());
    const availability = await getInventoryCounts(square, locationId, variationIds);
    const insufficient = [] as Array<{
      variationId: string;
      name: string;
      requested: number;
      available: number;
    }>;

    for (const [variationId, request] of requestedByVariation.entries()) {
      const available = Math.max(0, availability.get(variationId) ?? 0);
      if (request.quantity > available) {
        insufficient.push({
          variationId,
          name: request.name,
          requested: request.quantity,
          available,
        });
      }
    }

    if (insufficient.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Some items are no longer in stock.",
          insufficient,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    const subtotalCents = cartItems.reduce((sum, item) => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.priceCents) || 0;
      return sum + Math.max(0, quantity) * Math.max(0, price);
    }, 0);

    const { shippingCents } = calculateShipping(subtotalCents);

    const lineItems: Square.OrderLineItem[] = cartItems.map((item) => ({
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)).toString(),
      catalogObjectId: item.variationId,
      name: item.name,
    }));

    const serviceCharges: Square.OrderServiceCharge[] = shippingCents
      ? [
          {
            name: "Shipping",
            amountMoney: {
              amount: toBigIntAmount(shippingCents),
              currency: CURRENCY,
            },
            calculationPhase: "SUBTOTAL_PHASE",
            taxable: true,
          },
        ]
      : [];

    const address: Square.Address = {
      addressLine1: shipping.address1,
      addressLine2: shipping.address2 || undefined,
      locality: shipping.city,
      administrativeDistrictLevel1: shipping.state,
      postalCode: shipping.postalCode,
      country: "US",
    };

    const fulfillments: Square.Fulfillment[] = [
      {
        type: "SHIPMENT",
        shipmentDetails: {
          recipient: {
            displayName: shipping.fullName,
            emailAddress: shipping.email,
            phoneNumber: shipping.phone,
            address,
          },
          shippingNote: shipping.notes || undefined,
        },
      },
    ];

    const order: Square.Order = {
      locationId,
      lineItems,
      serviceCharges,
      fulfillments,
      pricingOptions: {
        autoApplyTaxes: true,
      },
    };

    const idempotencyKey = isNonEmpty(body?.idempotencyKey)
      ? body.idempotencyKey
      : randomUUID();

    const orderRes = await square.orders.create({
      order,
      idempotencyKey,
    });

    if (orderRes.errors?.length) {
      return new Response(JSON.stringify({ error: orderRes.errors[0]?.detail || "Order error" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const createdOrder = orderRes.order;
    if (!createdOrder?.id) {
      return new Response(JSON.stringify({ error: "Order could not be created." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const totals = {
      subtotalCents,
      shippingCents,
      taxCents: Number(createdOrder.totalTaxMoney?.amount ?? 0),
      totalCents: Number(createdOrder.totalMoney?.amount ?? 0),
    };

    return new Response(
      JSON.stringify({
        orderId: createdOrder.id,
        totals,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "Checkout failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
