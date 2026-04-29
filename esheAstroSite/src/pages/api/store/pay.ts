import type { APIRoute } from "astro";
import { SquareClient, SquareEnvironment } from "square";
import { randomUUID } from "crypto";

export const prerender = false;

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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const sourceId = body?.sourceId;
    const orderId = body?.orderId;
    const buyerEmail = body?.buyerEmail;

    if (!isNonEmpty(sourceId) || !isNonEmpty(orderId)) {
      return new Response(JSON.stringify({ error: "Missing payment data." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const square = getSquareClient();

    const orderRes = await square.orders.get({ orderId });
    if (orderRes.errors?.length) {
      return new Response(JSON.stringify({ error: orderRes.errors[0]?.detail || "Order lookup failed." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const order = orderRes.order;
    if (!order?.totalMoney) {
      return new Response(JSON.stringify({ error: "Order total unavailable." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const paymentRes = await square.payments.create({
      sourceId,
      idempotencyKey: isNonEmpty(body?.idempotencyKey) ? body.idempotencyKey : randomUUID(),
      amountMoney: order.totalMoney,
      orderId,
      locationId: order.locationId ?? import.meta.env.SQUARE_LOCATION_ID,
      buyerEmailAddress: isNonEmpty(buyerEmail) ? buyerEmail : undefined,
      autocomplete: true,
    });

    if (paymentRes.errors?.length) {
      return new Response(JSON.stringify({ error: paymentRes.errors[0]?.detail || "Payment failed." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payment = paymentRes.payment;

    return new Response(
      JSON.stringify({
        paymentId: payment?.id,
        orderId,
        status: payment?.status,
        receiptUrl: payment?.receiptUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "Payment failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
