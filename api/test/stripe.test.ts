import { describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "../src/lib/stripe";

async function signature(secret: string, timestamp: number, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Stripe webhook verification", () => {
  it("accepts a correctly signed, current payload", async () => {
    const now = 1_700_000_000;
    const payload = JSON.stringify({ id: "evt_123", type: "customer.subscription.updated", data: { object: {} } });
    const digest = await signature("whsec_test", now, payload);
    await expect(verifyStripeWebhook({ payload, signatureHeader: `t=${now},v1=${digest}`, webhookSecret: "whsec_test", now })).resolves.toMatchObject({ id: "evt_123" });
  });

  it("rejects altered or stale payloads", async () => {
    const now = 1_700_000_000;
    const payload = JSON.stringify({ id: "evt_123", type: "test", data: { object: {} } });
    const digest = await signature("whsec_test", now, payload);
    await expect(verifyStripeWebhook({ payload: `${payload} `, signatureHeader: `t=${now},v1=${digest}`, webhookSecret: "whsec_test", now })).resolves.toBeNull();
    await expect(verifyStripeWebhook({ payload, signatureHeader: `t=${now},v1=${digest}`, webhookSecret: "whsec_test", now: now + 301 })).resolves.toBeNull();
  });
});
