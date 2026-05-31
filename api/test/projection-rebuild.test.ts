import { describe, expect, it, vi } from "vitest";
import type { OpsEvent } from "@northline/shared";

const sqlCalls = vi.hoisted(() => ({ items: [] as string[] }));

vi.mock("../src/lib/db", () => ({
  withTenant: async (_env: unknown, _tenantId: string, fn: (sql: unknown) => Promise<unknown>) => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.items.push(
        strings.reduce((query, chunk, index) => `${query}${chunk}${index < values.length ? `:${String(values[index])}:` : ""}`, "")
      );
      return [];
    };

    return fn(sql);
  }
}));

function event(event_type: OpsEvent["event_type"], payload_json: Record<string, unknown>): OpsEvent {
  return {
    event_id: `evt_${event_type.toLowerCase()}_${String(payload_json.catch_id ?? payload_json.gear_id ?? "1")}`,
    tenant_id: "tenant_1",
    subject_type: "VESSEL",
    subject_id: String(payload_json.trip_id ?? "trip_1"),
    actor_id: "captain_1",
    device_id: "device_1",
    ts_device: "2026-05-31T07:00:00.000Z",
    ts_server: "2026-05-31T07:00:00.000Z",
    event_type,
    schema_version: 1,
    payload_json,
    event_hash: "hash",
    signature: "server-generated"
  };
}

describe("projection rebuild persistence", () => {
  it("rebuilds offshore gear against the deployed schema and removes stale trip rows first", async () => {
    sqlCalls.items = [];
    const { rebuildGearStateOffshore } = await import("../src/services/projection");

    const result = await rebuildGearStateOffshore({} as never, "tenant_1", "trip_1", [
      event("GEAR_REGISTERED", {
        trip_id: "trip_1",
        gear_id: "gear_1",
        mode: "OFFSHORE",
        buoy_label: "B-12",
        pot_count: 20
      }),
      event("GEAR_SET", {
        trip_id: "trip_1",
        gear_id: "gear_1",
        mode: "OFFSHORE",
        position: { lat: 55.1, lon: -166.2 }
      })
    ]);

    const sql = sqlCalls.items.join("\n");
    expect(result.errors).toEqual([]);
    expect(sql).toContain("delete from gear_state_offshore");
    expect(sql).toContain("buoy_label, pot_count, line_length_m");
    expect(sql).not.toContain("metadata");
    expect(sql).not.toContain("last_seen_at");
  });

  it("rebuilds catch rollups with corrections against the deployed schema", async () => {
    sqlCalls.items = [];
    const { rebuildCatchRollups } = await import("../src/services/projection");

    const result = await rebuildCatchRollups({} as never, "tenant_1", "trip_1", [
      event("CATCH_RECORDED", {
        catch_id: "catch_1",
        trip_id: "trip_1",
        mode: "OFFSHORE",
        species: "cod",
        kept: true,
        weight_kg: 2.5,
        length_cm: 61
      }),
      event("CATCH_CORRECTED", {
        catch_id: "catch_1",
        trip_id: "trip_1",
        corrections: {
          kept: false,
          weight_kg: 0
        }
      })
    ]);

    const sql = sqlCalls.items.join("\n");
    expect(result.errors).toEqual([]);
    expect(sql).toContain("delete from catch_rollups");
    expect(sql).toContain("rollup_id, tenant_id, trip_id, mode, species, kept_count, released_count");
    expect(sql).toContain(":0:");
    expect(sql).toContain(":1:");
    expect(sql).not.toContain("avg_length_cm");
    expect(sql).not.toContain("on conflict (trip_id, species)");
  });
});
