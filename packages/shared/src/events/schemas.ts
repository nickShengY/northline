import { z } from "zod";
import { eventTypes } from "./types";

const knownEventTypes = new Set<string>(eventTypes);

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function fitsJsonByteLimit(maxBytes: number) {
  return (value: unknown) => jsonByteLength(value) <= maxBytes;
}

export const pointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180)
});

export const tripPlannedSchema = z.object({
  trip_id: z.string().min(6),
  mode: z.enum(["OFFSHORE", "ICE"]),
  owner_id: z.string(),
  location_name: z.string().optional(),
  return_by: z.string().datetime().optional(),
  crew_ids: z.array(z.string()).max(100).default([])
});

export const gearRegisteredSchema = z.object({
  trip_id: z.string(),
  gear_id: z.string(),
  mode: z.enum(["OFFSHORE", "ICE"]),
  label: z.string(),
  metadata: z.record(z.any()).default({}).refine(
    fitsJsonByteLimit(16 * 1024),
    "metadata must be 16384 bytes or less"
  )
});

export const gearTransitionSchema = z.object({
  trip_id: z.string(),
  gear_id: z.string(),
  position: pointSchema.optional(),
  note: z.string().optional()
});

export const catchRecordedSchema = z.object({
  trip_id: z.string(),
  catch_id: z.string(),
  species: z.string(),
  kept: z.boolean(),
  length_cm: z.number().positive().optional(),
  weight_kg: z.number().positive().optional(),
  station_or_cycle_id: z.string().optional(),
  evidence_media_id: z.string().optional()
});

export const complianceValidationSchema = z.object({
  trip_id: z.string(),
  pkg_id: z.string(),
  completion_meter: z.number().min(0).max(100),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["error", "warning"]),
      message: z.string(),
      fix_hint: z.string().optional()
    })
  ).max(250)
});

export const hazardReportedSchema = z.object({
  trip_id: z.string().optional(),
  hazard_id: z.string(),
  hazard_type: z.enum(["CRACK", "SLUSH", "RIDGE", "OPEN_WATER", "WEATHER", "GEAR_RISK"]),
  severity: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  location: pointSchema,
  sharing_scope: z.enum(["PRIVATE", "GROUP", "ORG", "DELAYED_PUBLIC", "PUBLIC"])
});

export const trainingAssignedSchema = z.object({
  assign_id: z.string(),
  user_id: z.string(),
  module_id: z.string(),
  reason: z.string(),
  due_at: z.string().datetime().optional()
});

export const lotCreatedSchema = z.object({
  lot_id: z.string(),
  trip_id: z.string(),
  mode: z.enum(["OFFSHORE", "ICE"]),
  species_totals: z.record(z.number()).default({}),
  quality_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(16 * 1024),
    "quality_json must be 16384 bytes or less"
  ).optional()
});

export const lotScanAttachedSchema = z.object({
  lot_id: z.string(),
  trip_id: z.string(),
  batch_id: z.string(),
  source: z.enum(["API", "CSV", "JSON", "MANUAL"]),
  species_totals: z.record(z.number()).default({})
});

export const lotScanMismatchSchema = z.object({
  lot_id: z.string(),
  trip_id: z.string(),
  batch_id: z.string(),
  mismatch_rate: z.number().min(0),
  expected_total: z.number().min(0),
  observed_total: z.number().min(0)
});

export const gearSweepSchema = z.object({
  trip_id: z.string(),
  mode: z.enum(["OFFSHORE", "ICE"]),
  outstanding_gear_ids: z.array(z.string()).max(500).default([])
});

export const checkinSchema = z.object({
  trip_id: z.string(),
  checkin_id: z.string(),
  due_at: z.string().datetime().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "MISSED", "ESCALATED"]),
  location: pointSchema.optional()
});

export const deviceLifecycleSchema = z.object({
  device_id: z.string(),
  subject_type: z.enum(["VESSEL", "USER", "GROUP", "ORG"]),
  subject_id: z.string(),
  key_version: z.number().int().positive().optional()
});

export const schemaByEventType = {
  TRIP_PLANNED: tripPlannedSchema,
  GEAR_REGISTERED: gearRegisteredSchema,
  GEAR_SET: gearTransitionSchema,
  GEAR_CHECKED: gearTransitionSchema,
  GEAR_HAULED: gearTransitionSchema,
  GEAR_MARKED_MISSING: gearTransitionSchema,
  GEAR_RECOVERED: gearTransitionSchema,
  GEAR_REMOVED: gearTransitionSchema,
  GEAR_SWEEP_BLOCKED: gearSweepSchema,
  GEAR_SWEEP_CONFIRMED: gearSweepSchema,
  CATCH_RECORDED: catchRecordedSchema,
  CATCH_CORRECTED: catchRecordedSchema.partial({ catch_id: true }),
  COMPLIANCE_VALIDATION_RAN: complianceValidationSchema,
  LOT_CREATED: lotCreatedSchema,
  LOT_SCAN_ATTACHED: lotScanAttachedSchema,
  LOT_SCAN_MISMATCH_FLAGGED: lotScanMismatchSchema,
  HAZARD_REPORTED: hazardReportedSchema,
  HAZARD_CONFIRMED: z.object({ hazard_id: z.string() }),
  CHECKIN_SCHEDULED: checkinSchema,
  CHECKIN_COMPLETED: checkinSchema,
  CHECKIN_MISSED: checkinSchema,
  CHECKIN_ESCALATED: checkinSchema,
  DEVICE_REGISTERED: deviceLifecycleSchema,
  DEVICE_REVOKED: deviceLifecycleSchema,
  TRAINING_ASSIGNED: trainingAssignedSchema,
  TRAINING_COMPLETED: z.object({ assign_id: z.string(), score: z.number().min(0).max(100).optional() })
} as const;

export const envelopeSchema = z.object({
  event_id: z.string().min(8),
  tenant_id: z.string().min(2),
  subject_type: z.enum(["VESSEL", "USER", "GROUP", "ORG"]),
  subject_id: z.string().min(2),
  actor_id: z.string().min(2),
  device_id: z.string().min(2),
  ts_device: z.string().datetime(),
  event_type: z.enum(eventTypes),
  schema_version: z.number().int().positive(),
  payload_json: z.unknown(),
  prev_hash: z.string().optional(),
  event_hash: z.string(),
  signature: z.string()
});

export function validatePayload(eventType: string, payload: unknown) {
  const schema = (schemaByEventType as Record<string, z.ZodTypeAny>)[eventType];
  if (!schema && !knownEventTypes.has(eventType)) {
    return { ok: false as const, error: { formErrors: [`Unknown event type: ${eventType}`], fieldErrors: {} } };
  }
  const parsed = (schema ?? z.record(z.unknown())).safeParse(payload);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.flatten() };
  }
  return { ok: true as const, data: parsed.data };
}
