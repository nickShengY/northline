import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import app from "../src/index";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function jwtFixture(options: {
  tenantId?: string | null;
  role?: string | null;
  expiration?: string | null;
} = {}) {
  const {
    tenantId = "tenant_live",
    role = "GUIDE",
    expiration = "5m"
  } = options;
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const base64 = bytesToBase64(new Uint8Array(spki)).match(/.{1,64}/g)?.join("\n") ?? "";
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
  let builder = new SignJWT({
    ...(tenantId ? { tenant_id: tenantId } : {}),
    ...(role ? { role } : {})
  })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("guide_1")
    .setIssuer("https://identity.example")
    .setAudience("northline-api")
    .setIssuedAt();

  if (expiration) {
    builder = builder.setExpirationTime(expiration);
  }

  const token = await builder.sign(keyPair.privateKey);

  return { publicKeyPem, token };
}

async function requestSessionWithFixture(options: Parameters<typeof jwtFixture>[0]) {
  const { publicKeyPem, token } = await jwtFixture(options);
  return app.request(
    "/v1/auth/session",
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    {
      APP_ENV: "production",
      JWT_PUBLIC_KEY: publicKeyPem,
      JWT_ISSUER: "https://identity.example",
      JWT_AUDIENCE: "northline-api",
      R2_BUCKET: bucket
    }
  );
}

describe("auth middleware", () => {
  it("accepts dev tokens only in development", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "development",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).not.toBe(401);
  });

  it("rejects forgeable dev tokens in staging", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:attacker:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "staging",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(401);
  });

  it("rejects forgeable dev tokens in production", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:attacker:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "production",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(401);
  });

  it("accepts issuer- and audience-constrained RS256 JWTs outside development", async () => {
    const { publicKeyPem, token } = await jwtFixture();
    const response = await app.request(
      "/v1/auth/session",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      },
      {
        APP_ENV: "production",
        JWT_PUBLIC_KEY: publicKeyPem,
        JWT_ISSUER: "https://identity.example",
        JWT_AUDIENCE: "northline-api",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tenant_id: "tenant_live",
      actor_id: "guide_1",
      role: "GUIDE",
      capabilities: expect.arrayContaining(["hazards:share"])
    });
  });

  it("rejects production JWTs without an explicit tenant claim", async () => {
    const response = await requestSessionWithFixture({ tenantId: null });

    expect(response.status).toBe(401);
  });

  it("rejects production JWTs without a valid role claim", async () => {
    const [missingRole, invalidRole] = await Promise.all([
      requestSessionWithFixture({ role: null }),
      requestSessionWithFixture({ role: "SUPERUSER" })
    ]);

    expect(missingRole.status).toBe(401);
    expect(invalidRole.status).toBe(401);
  });

  it("rejects production JWTs without an expiration", async () => {
    const response = await requestSessionWithFixture({ expiration: null });

    expect(response.status).toBe(401);
  });
});
