import { describe, expect, it } from "vitest";
import app from "../src/index";

const bucket = { put: async () => undefined, get: async () => null };

describe("billing routes", () => {
  it("reaches the Stripe webhook signature gate without bearer authentication", async () => {
    const response = await app.request(
      "/v1/billing/webhook",
      { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: "{}" },
      { APP_ENV: "production", R2_BUCKET: bucket, STRIPE_WEBHOOK_SECRET: "whsec_test" }
    );

    // A 400 signature failure proves this request reached the webhook handler;
    // auth middleware would have rejected its intentionally absent bearer token with 401.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_stripe_signature" });
  });

  it("keeps checkout behind tenant authentication", async () => {
    const response = await app.request(
      "/v1/billing/checkout",
      { method: "POST" },
      { APP_ENV: "production", R2_BUCKET: bucket }
    );
    expect(response.status).toBe(401);
  });
});
