import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeToken,
  consumeRuntimeTokenFromUrl,
  NORTHLINE_TOKEN_STORAGE_KEY,
  readRuntimeToken,
  requireRuntimeToken,
  writeRuntimeToken
} from "../src/auth/session";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function installWindow() {
  vi.stubGlobal("window", {
    location: { href: "https://ops.example/" },
    history: {
      state: {},
      replaceState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
        window.history.state = state;
        if (url) window.location.href = String(url);
      })
    },
    sessionStorage: new MemoryStorage(),
    localStorage: new MemoryStorage()
  });
}

describe("runtime session token storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers session tokens over remembered local tokens", () => {
    installWindow();

    window.localStorage.setItem(NORTHLINE_TOKEN_STORAGE_KEY, "remembered");
    window.sessionStorage.setItem(NORTHLINE_TOKEN_STORAGE_KEY, "current");

    expect(readRuntimeToken()).toBe("current");
  });

  it("moves tokens between persistence stores without leaving stale copies", () => {
    installWindow();

    writeRuntimeToken("remembered", "local");
    expect(window.localStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY)).toBe("remembered");
    expect(window.sessionStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY)).toBeNull();

    writeRuntimeToken("current", "session");
    expect(window.sessionStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY)).toBe("current");
    expect(window.localStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("uses explicit development fallback only when storage is empty", () => {
    installWindow();

    expect(requireRuntimeToken("dev")).toBe("dev");

    writeRuntimeToken("runtime", "session");
    expect(requireRuntimeToken("dev")).toBe("runtime");

    clearRuntimeToken();
    expect(() => requireRuntimeToken()).toThrow("Missing API token");
  });

  it("consumes IdP redirect tokens from URL fragments and removes them from browser history", () => {
    installWindow();
    window.location.href = "https://ops.example/app?view=portal#access_token=jwt_123&state=abc";

    expect(consumeRuntimeTokenFromUrl()).toBe("jwt_123");
    expect(readRuntimeToken()).toBe("jwt_123");
    expect(window.location.href).toBe("https://ops.example/app?view=portal#state=abc");
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("consumes query token handoffs for providers that do not use fragments", () => {
    installWindow();
    window.location.href = "https://ops.example/app?token=jwt_456&mode=portal";

    expect(consumeRuntimeTokenFromUrl("local")).toBe("jwt_456");
    expect(window.localStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY)).toBe("jwt_456");
    expect(window.location.href).toBe("https://ops.example/app?mode=portal");
  });
});
