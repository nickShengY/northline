/**
 * Semantic Transport Layer (STL) Service
 *
 * Optimizes data transfer under weak connectivity by prioritizing
 * "meaning-first packets" (semantic deltas, previews) over full raw uploads,
 * while preserving lossless audit truth.
 */

export type PacketPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BATCH';
export type PacketStatus = 'QUEUED' | 'UPLOADING' | 'UPLOADED' | 'ACKNOWLEDGED' | 'FAILED';

export interface SemanticPacket {
  packet_id: string;
  tenant_id: string;
  device_id: string;
  trip_id?: string;

  // Priority determines upload order
  priority: PacketPriority;

  // Semantic preview - compact representation for quick display
  preview_json: {
    event_type: string;
    summary: string;
    key_fields: Record<string, unknown>;
    timestamp: string;
  };

  // Full payload - uploaded when connectivity permits
  full_payload_json?: Record<string, unknown>;

  // Original event IDs this packet represents
  source_event_ids: string[];

  // Lossless reference - ensures audit trail integrity
  lossless_ref: string;

  // Size metadata
  preview_bytes: number;
  full_bytes: number;

  // Status tracking
  status: PacketStatus;
  retry_count: number;
  last_error?: string;

  // Timestamps
  created_at: string;
  uploaded_at?: string;
  acknowledged_at?: string;
}

export interface PacketQueueStats {
  total_packets: number;
  total_bytes: number;
  by_priority: Record<PacketPriority, { count: number; bytes: number }>;
  oldest_pending?: string;
  retry_pending: number;
}

/**
 * Priority classification rules based on event type
 */
export function classifyEventPriority(eventType: string): PacketPriority {
  // CRITICAL: Safety emergencies, MOB, immediate hazards
  if (['MOB_DETECTED', 'EMERGENCY_DECLARED', 'HAZARD_CRITICAL', 'INCIDENT_OPENED'].includes(eventType)) {
    return 'CRITICAL';
  }

  // HIGH: Safety events, compliance violations, gear issues
  if (['INJURY_REPORTED', 'HAZARD_REPORTED', 'COMPLIANCE_VIOLATION', 'GEAR_MARKED_MISSING',
       'CHECKIN_MISSED', 'STOP_WORK_ISSUED'].includes(eventType)) {
    return 'HIGH';
  }

  // NORMAL: Standard operational events
  if (['TRIP_STARTED', 'TRIP_ENDED', 'GEAR_SET', 'GEAR_HAULED', 'CATCH_RECORDED',
       'STATION_VISITED', 'CHECKIN_COMPLETED', 'TRAINING_COMPLETED'].includes(eventType)) {
    return 'NORMAL';
  }

  // LOW: Non-urgent updates
  if (['GEAR_CHECKED', 'NOTE_ADDED', 'POSITION_LOGGED', 'WEATHER_LOGGED'].includes(eventType)) {
    return 'LOW';
  }

  // BATCH: Bulk data, can wait for good connectivity
  return 'BATCH';
}

/**
 * Generate a semantic preview from a full event payload
 */
export function generatePreview(event: {
  event_type: string;
  payload_json: Record<string, unknown>;
  ts_device: string;
}): SemanticPacket['preview_json'] {
  const { event_type, payload_json, ts_device } = event;

  const summary = generateSummary(event_type, payload_json);
  const keyFields = extractKeyFields(event_type, payload_json);

  return {
    event_type,
    summary,
    key_fields: keyFields,
    timestamp: ts_device
  };
}

function generateSummary(eventType: string, payload: Record<string, unknown>): string {
  switch (eventType) {
    case 'MOB_DETECTED':
      return `MOB alert at ${payload.location_name || 'unknown location'}`;
    case 'EMERGENCY_DECLARED':
      return `Emergency: ${payload.emergency_type || 'unspecified'}`;
    case 'HAZARD_REPORTED':
      return `Hazard: ${payload.hazard_type || 'unknown'} (${payload.severity || 'unknown severity'})`;
    case 'INJURY_REPORTED':
      return `Injury: ${payload.injury_type || 'unknown'} - ${payload.severity || 'unknown severity'}`;
    case 'TRIP_STARTED':
      return `Trip ${payload.trip_id} started`;
    case 'TRIP_ENDED':
      return `Trip ${payload.trip_id} ended`;
    case 'GEAR_SET':
      return `Gear ${payload.gear_id} set at ${payload.location_name || 'new position'}`;
    case 'GEAR_HAULED':
      return `Gear ${payload.gear_id} hauled`;
    case 'GEAR_CHECKED':
      return `Gear ${payload.gear_id} checked`;
    case 'CATCH_RECORDED':
      return `Catch: ${(payload.species_totals as Record<string, number>)?.total || 0} lbs`;
    case 'CHECKIN_COMPLETED':
      return `Check-in completed`;
    case 'CHECKIN_MISSED':
      return `MISSED check-in - overdue`;
    case 'INCIDENT_OPENED':
      return `Incident: ${payload.category || 'unknown'} (${payload.severity || 'unknown severity'})`;
    case 'TRAINING_ASSIGNED':
      return `Training assigned: ${payload.module_id}`;
    case 'TRAINING_COMPLETED':
      return `Training completed: ${payload.module_id}`;
    default:
      return eventType.replace(/_/g, ' ').toLowerCase();
  }
}

function extractKeyFields(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  // Extract only the most critical fields for quick display
  const keyFields: Record<string, unknown> = {};

  // Common fields
  if (payload.trip_id) keyFields.trip_id = payload.trip_id;
  if (payload.gear_id) keyFields.gear_id = payload.gear_id;
  if (payload.severity) keyFields.severity = payload.severity;
  if (payload.location) keyFields.location = payload.location;

  // Event-specific fields
  switch (eventType) {
    case 'MOB_DETECTED':
      if (payload.coordinates) keyFields.coordinates = payload.coordinates;
      if (payload.time_in_water) keyFields.time_in_water = payload.time_in_water;
      break;
    case 'CATCH_RECORDED':
      if (payload.species_totals) keyFields.species_totals = payload.species_totals;
      if (payload.quality_grade) keyFields.quality_grade = payload.quality_grade;
      break;
    case 'HAZARD_REPORTED':
      if (payload.hazard_type) keyFields.hazard_type = payload.hazard_type;
      if (payload.confidence) keyFields.confidence = payload.confidence;
      break;
    case 'INCIDENT_OPENED':
      if (payload.case_id) keyFields.case_id = payload.case_id;
      if (payload.category) keyFields.category = payload.category;
      break;
  }

  return keyFields;
}

/**
 * Calculate packet size for bandwidth planning
 */
export function calculatePacketSize(preview: SemanticPacket['preview_json'], fullPayload?: Record<string, unknown>): {
  preview_bytes: number;
  full_bytes: number;
} {
  const previewStr = JSON.stringify(preview);
  const previewBytes = new TextEncoder().encode(previewStr).length;

  let fullBytes = previewBytes;
  if (fullPayload) {
    const fullStr = JSON.stringify(fullPayload);
    fullBytes = new TextEncoder().encode(fullStr).length;
  }

  return { preview_bytes: previewBytes, full_bytes: fullBytes };
}

/**
 * STL upload strategy based on connectivity quality
 */
export interface ConnectivityQuality {
  bandwidth_kbps: number;
  latency_ms: number;
  packet_loss_rate: number;
}

export function determineUploadStrategy(
  connectivity: ConnectivityQuality,
  queueStats: PacketQueueStats
): {
  mode: 'PREVIEW_ONLY' | 'HYBRID' | 'FULL';
  max_packets: number;
  include_full_for_priority: PacketPriority[];
} {
  const { bandwidth_kbps, latency_ms, packet_loss_rate } = connectivity;

  // Score connectivity quality (0-100)
  const bandwidthScore = Math.min(100, bandwidth_kbps / 100); // 100kbps = score 100
  const latencyScore = Math.max(0, 100 - (latency_ms / 10)); // 1000ms = score 0
  const lossScore = Math.max(0, 100 - (packet_loss_rate * 100));

  const qualityScore = (bandwidthScore * 0.4 + latencyScore * 0.3 + lossScore * 0.3);

  if (qualityScore < 20) {
    // Very poor connectivity - preview only for critical items
    return {
      mode: 'PREVIEW_ONLY',
      max_packets: 5,
      include_full_for_priority: ['CRITICAL']
    };
  } else if (qualityScore < 50) {
    // Poor connectivity - hybrid mode
    return {
      mode: 'HYBRID',
      max_packets: 20,
      include_full_for_priority: ['CRITICAL', 'HIGH']
    };
  } else if (qualityScore < 80) {
    // Moderate connectivity - mostly full
    return {
      mode: 'HYBRID',
      max_packets: 50,
      include_full_for_priority: ['CRITICAL', 'HIGH', 'NORMAL']
    };
  } else {
    // Good connectivity - full upload
    return {
      mode: 'FULL',
      max_packets: 100,
      include_full_for_priority: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BATCH']
    };
  }
}

/**
 * Merge semantic packets into a compact sync envelope
 */
export function mergePacketsForUpload(
  packets: SemanticPacket[],
  strategy: ReturnType<typeof determineUploadStrategy>
): {
  preview_envelope: Array<SemanticPacket['preview_json'] & { packet_id: string }>;
  full_payloads: Array<{ packet_id: string; payload: Record<string, unknown> }>;
  total_bytes: number;
} {
  const previewEnvelope: Array<SemanticPacket['preview_json'] & { packet_id: string }> = [];
  const fullPayloads: Array<{ packet_id: string; payload: Record<string, unknown> }> = [];
  let totalBytes = 0;

  const maxPackets = Math.min(packets.length, strategy.max_packets);

  for (let i = 0; i < maxPackets; i++) {
    const packet = packets[i];
    if (!packet) continue;

    // Always include preview
    previewEnvelope.push({
      packet_id: packet.packet_id,
      ...packet.preview_json
    });
    totalBytes += packet.preview_bytes;

    // Include full payload based on strategy
    if (strategy.include_full_for_priority.includes(packet.priority) && packet.full_payload_json) {
      fullPayloads.push({
        packet_id: packet.packet_id,
        payload: packet.full_payload_json
      });
      totalBytes += packet.full_bytes;
    }
  }

  return {
    preview_envelope: previewEnvelope,
    full_payloads: fullPayloads,
    total_bytes: totalBytes
  };
}
