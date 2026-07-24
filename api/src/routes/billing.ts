import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { requireRole } from "../lib/rbac";
import { createStripeCheckoutSession, verifyStripeWebhook, type StripeEvent } from "../lib/stripe";

export const billingRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

const tenantIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function webhookTenant(event: StripeEvent): string | null {
  const object = event.data.object;
  const metadata = object.metadata;
  const metadataTenant = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).tenant_id
    : undefined;
  const candidate = typeof metadataTenant === "string"
    ? metadataTenant
    : typeof object.client_reference_id === "string" ? object.client_reference_id : null;
  return candidate && tenantIdSchema.safeParse(candidate).success ? candidate : null;
}

function entitlementUpdate(event: StripeEvent) {
  const object = event.data.object;
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && object.mode !== "subscription") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    if (!sessionId) return null;
    const paymentStatus = object.payment_status;
    return {
      key: `checkout:${sessionId}`,
      checkoutSessionId: sessionId,
      subscriptionId: null,
      customerId: typeof object.customer === "string" ? object.customer : null,
      status: paymentStatus === "paid" || paymentStatus === "no_payment_required" ? "active" : "pending",
      priceId: null,
      currentPeriodEnd: null
    };
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscriptionId = typeof object.id === "string" ? object.id : null;
    if (!subscriptionId) return null;
    const stripeStatus = typeof object.status === "string" ? object.status : "incomplete";
    const item = Array.isArray(object.items) ? object.items[0] : (object.items as Record<string, unknown> | undefined)?.data;
    const firstItem = Array.isArray(item) ? item[0] as Record<string, unknown> | undefined : undefined;
    const price = firstItem?.price as Record<string, unknown> | undefined;
    const periodEnd = typeof object.current_period_end === "number"
      ? new Date(object.current_period_end * 1000).toISOString()
      : null;
    return {
      key: `subscription:${subscriptionId}`,
      checkoutSessionId: null,
      subscriptionId,
      customerId: typeof object.customer === "string" ? object.customer : null,
      status: event.type === "customer.subscription.deleted" ? "canceled" : (stripeStatus === "active" || stripeStatus === "trialing" ? "active" : stripeStatus),
      priceId: typeof price?.id === "string" ? price.id : null,
      currentPeriodEnd: periodEnd
    };
  }
  return null;
}

billingRouter.post("/checkout", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  try {
    const session = await createStripeCheckoutSession({
      env: c.env,
      tenantId: auth.tenantId,
      actorId: auth.actorId,
      idempotencyKey: crypto.randomUUID()
    });
    return c.json({ checkout_session_id: session.id, checkout_url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe_unavailable";
    console.error(JSON.stringify({ event: "stripe_checkout_failed", tenant_id: auth.tenantId, reason: message }));
    if (message.includes(" is required") || message.includes("must be")) {
      return c.json({ error: "billing_not_configured" }, 503);
    }
    return c.json({ error: "billing_unavailable" }, 502);
  }
});

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const payload = await request.text();
  const event = await verifyStripeWebhook({
    payload,
    signatureHeader: request.headers.get("stripe-signature") ?? undefined,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET
  });
  if (!event) return Response.json({ error: "invalid_stripe_signature" }, { status: 400 });

  const tenantId = webhookTenant(event);
  if (!tenantId) {
    // A verified event without our tenant metadata must never affect another tenant.
    return Response.json({ received: true, ignored: true });
  }
  const update = entitlementUpdate(event);
  await withTenant(env, tenantId, async (sql) => {
    if (!update) {
      await sql`
        insert into stripe_webhook_event (tenant_id, stripe_event_id, event_type, received_at)
        values (${tenantId}, ${event.id}, ${event.type}, now())
        on conflict (tenant_id, stripe_event_id) do nothing
      `;
      return;
    }

    // One statement makes accepting the event and updating its entitlement atomic.
    await sql`
      with received as (
        insert into stripe_webhook_event (tenant_id, stripe_event_id, event_type, received_at)
        values (${tenantId}, ${event.id}, ${event.type}, now())
        on conflict (tenant_id, stripe_event_id) do nothing
        returning 1
      )
      insert into billing_entitlement (
        tenant_id, entitlement_key, stripe_checkout_session_id, stripe_subscription_id,
        stripe_customer_id, status, stripe_price_id, current_period_end, updated_at
      )
      select ${tenantId}, ${update.key}, ${update.checkoutSessionId}, ${update.subscriptionId},
        ${update.customerId}, ${update.status}, ${update.priceId}, ${update.currentPeriodEnd}::timestamptz, now()
      from received
      on conflict (tenant_id, entitlement_key) do update set
        stripe_checkout_session_id = coalesce(excluded.stripe_checkout_session_id, billing_entitlement.stripe_checkout_session_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, billing_entitlement.stripe_subscription_id),
        stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_entitlement.stripe_customer_id),
        status = excluded.status,
        stripe_price_id = coalesce(excluded.stripe_price_id, billing_entitlement.stripe_price_id),
        current_period_end = coalesce(excluded.current_period_end, billing_entitlement.current_period_end),
        updated_at = now()
    `;
  });
  return Response.json({ received: true });
}
