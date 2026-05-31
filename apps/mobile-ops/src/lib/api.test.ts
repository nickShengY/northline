import { afterEach, describe, expect, it, vi } from "vitest";
import { ackSyncCursor, downloadEvents, getTripGear, uploadEvents } from "./api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("mobile sync api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes the durable download cursor when uploading queued events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: ["evt_1"], rejected: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadEvents([{ event_id: "evt_1" }], "2026-05-31T00:00:00.000Z|evt_0");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      cursor: "2026-05-31T00:00:00.000Z|evt_0",
      events: [{ event_id: "evt_1" }]
    });
  });

  it("downloads events with an encoded cursor and bounded limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      cursor: "2026-05-31T00:01:00.000Z|evt_2",
      events: []
    }));
    vi.stubGlobal("fetch", fetchMock);

    await downloadEvents("2026-05-31T00:00:00.000Z|evt_1", 500);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/sync/download?");
    expect(url).toContain("cursor=2026-05-31T00%3A00%3A00.000Z%7Cevt_1");
    expect(url).toContain("limit=500");
    expect(init.headers).toHaveProperty("Authorization");
  });

  it("encodes trip ids used as API path segments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ gear: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getTripGear("trip/with space");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/gear/trip/trip%2Fwith%20space?mode=OFFSHORE");
  });

  it("acknowledges the cursor after durable receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      cursor: "2026-05-31T00:01:00.000Z|evt_2",
      acknowledged_at: "2026-05-31T00:01:01.000Z"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await ackSyncCursor("2026-05-31T00:01:00.000Z|evt_2");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/sync/ack");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ cursor: "2026-05-31T00:01:00.000Z|evt_2" });
  });
});
