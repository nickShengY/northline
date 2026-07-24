import type { Env } from "../types";

const stripeApiUrl = "https://api.stripe.com/v1";
const signatureToleranceSeconds = 300;

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function configuredUrl(value: string | undefined, name: string, env: Env): string {
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (env.APP_ENV !== "development" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS outside development`);
  }
  return url.toString();
}

function stripeConfig(env: Env) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
  if (!env.STRIPE_PRICE_ID) throw new Error("STRIPE_PRICE_ID is required");
  const mode = env.STRIPE_CHECKOUT_MODE ?? "subscription";
  if (mode !== "payment" && mode !== "subscription") {
    throw new Error("STRIPE_CHECKOUT_MODE must be payment or subscription");
  }
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    priceId: env.STRIPE_PRICE_ID,
    mode,
    successUrl: configuredUrl(env.STRIPE_SUCCESS_URL, "STRIPE_SUCCESS_URL", env),
    cancelUrl: configuredUrl(env.STRIPE_CANCEL_URL, "STRIPE_CANCEL_URL", env)
  };
}

function stripeErrorMessage(status: number) {
  return `stripe_request_failed:${status}`;
}

export async function createStripeCheckoutSession(input: {
  env: Env;
  tenantId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<StripeCheckoutSession> {
  const config = stripeConfig(input.env);
  const params = new URLSearchParams({
    mode: config.mode,
    success_url: config.successUrl,
    cancel_url: config.cancelUrl,
    client_reference_id: input.tenantId,
    "line_items[0][price]": config.priceId,
    "line_items[0][quantity]": "1",
    "metadata[tenant_id]": input.tenantId,
    "metadata[actor_id]": input.actorId
  });

  // Stripe does not automatically copy Checkout Session metadata to a subscription.
  // Persist it there so later subscription webhooks remain tenant-scoped.
  if (config.mode === "subscription") {
    params.set("subscription_data[metadata][tenant_id]", input.tenantId);
    params.set("subscription_data[metadata][actor_id]", input.actorId);
  }

  const response = await fetch(`${stripeApiUrl}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey
    },
    body: params.toString()
  });
  if (!response.ok) throw new Error(stripeErrorMessage(response.status));

  const result = await response.json() as StripeCheckoutSession;
  if (!result.id || !result.url) throw new Error("stripe_invalid_checkout_session");
  return result;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fixedTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyStripeWebhook(input: {
  payload: string;
  signatureHeader: string | undefined;
  webhookSecret: string | undefined;
  now?: number;
}): Promise<StripeEvent | null> {
  if (!input.webhookSecret || !input.signatureHeader) return null;
  const parts = input.signatureHeader.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestampNumber = Number(timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!timestamp || !Number.isSafeInteger(timestampNumber) || Math.abs(now - timestampNumber) > signatureToleranceSeconds || !signatures.length) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${input.payload}`));
  const expected = hex(new Uint8Array(digest));
  if (!signatures.some((signature) => fixedTimeEqual(signature, expected))) return null;

  try {
    const event = JSON.parse(input.payload) as StripeEvent;
    if (!event.id || !event.type || !event.data?.object) return null;
    return event;
  } catch {
    return null;
  }
}
