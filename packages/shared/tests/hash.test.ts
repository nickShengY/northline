import { describe, expect, it } from "vitest";
import { sha256 } from "../src";

describe("sha256", () => {
  it("returns deterministic base64url digest", async () => {
    const a = await sha256("northline");
    const b = await sha256("northline");

    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("changes digest when payload changes", async () => {
    const a = await sha256("northline:a");
    const b = await sha256("northline:b");

    expect(a).not.toBe(b);
  });
});
