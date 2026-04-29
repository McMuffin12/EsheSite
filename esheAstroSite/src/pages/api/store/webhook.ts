import type { APIRoute } from "astro";
import { WebhooksHelper } from "square";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const signatureKey = import.meta.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    return new Response(JSON.stringify({ error: "Missing webhook signature key." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signature = request.headers.get("x-square-signature") || "";
  const body = await request.text();

  const isValid = WebhooksHelper.isValidWebhookEventSignature(
    body,
    signature,
    signatureKey,
    request.url
  );

  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid webhook signature." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = JSON.parse(body);
  console.log("[Square Webhook]", event?.type, event?.data?.id);

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
