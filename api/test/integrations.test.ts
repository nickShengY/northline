import { describe, expect, it } from "vitest";
import { redactIntegrationConfig } from "../src/routes/integrations";

describe("integration config redaction", () => {
  it("redacts top-level and nested secrets before returning configs", () => {
    expect(redactIntegrationConfig({
      endpoint: "https://provider.example",
      api_key: "live_api_key",
      token: "bearer_token",
      nested: {
        clientSecret: "client_secret",
        headers: {
          Authorization: "Bearer secret",
          "x-api-key": "nested_key"
        },
        safe: "visible"
      },
      replicas: [
        { access_key: "replica_key", region: "us-east" }
      ]
    })).toEqual({
      endpoint: "https://provider.example",
      api_key: "[REDACTED]",
      token: "[REDACTED]",
      nested: {
        clientSecret: "[REDACTED]",
        headers: {
          Authorization: "[REDACTED]",
          "x-api-key": "[REDACTED]"
        },
        safe: "visible"
      },
      replicas: [
        { access_key: "[REDACTED]", region: "us-east" }
      ]
    });
  });
});
