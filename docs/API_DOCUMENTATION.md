# Northline API Documentation

## Overview

The Northline API is a Cloudflare Workers-based serverless API that provides endpoints for fishing operations management, safety monitoring, gear tracking, and compliance management.

## Base URL

- **Development**: `http://127.0.0.1:8787`
- **Production**: `https://api.northline.fishing`

## Authentication

### Development Mode
```http
Authorization: Bearer <local-dev-token>
```

### Production Mode
```http
Authorization: Bearer <JWT_TOKEN>
```

## API Endpoints

### Platform Health

#### Liveness
```http
GET /health
```

Returns `200` when the Worker is reachable.

#### Readiness
```http
GET /ready
```

Returns deployment checks for database, artifact storage, CORS, and JWT controls. Production-like environments return `503` until required controls are configured.

### Sync Service

#### Upload Events
```http
POST /v1/sync/upload
Content-Type: application/json
Authorization: Bearer <token>

{
  "cursor": "2024-01-01T00:00:00Z",
  "events": [
    {
      "event_id": "01H8X9Y7Z6W5V4U3T2R1Q0P9O8N7M6L5K4J3H2G1F",
      "tenant_id": "tenant_123",
      "event_type": "TRIP_STARTED",
      "event_version": 1,
      "payload": {
        "trip_id": "trip_456",
        "vessel_id": "vessel_789",
        "start_time": "2024-01-01T00:00:00Z"
      },
      "device_id": "device_abc",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Response**:
```json
{
  "cursor": "2024-01-01T00:01:00Z",
  "accepted_count": 1,
  "rejected": [
    {
      "event_id": "evt_rejected_001",
      "reason": "hash_chain_conflict"
    }
  ],
  "server_generated_events": [
    {
      "event_type": "SYNC_VALIDATION_REJECTED",
      "ts_server": "2024-01-01T00:01:00Z",
      "payload_json": {
        "event_id": "evt_rejected_001",
        "reason": "hash_chain_conflict"
      }
    }
  ]
}
```

#### Download Events
```http
GET /v1/sync/download?cursor=2024-01-01T00:00:00Z|evt_001&limit=100
Authorization: Bearer <token>
```

**Response**:
```json
{
  "cursor": "2024-01-01T00:05:00Z|evt_002",
  "events": [
    {
      "event_id": "01H8X9Y7Z6W5V4U3T2R1Q0P9O8N7M6L5K4J3H2G1F",
      "tenant_id": "tenant_123",
      "event_type": "TRIP_STARTED",
      "event_version": 1,
      "payload": {...},
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Operations Service

#### Get Dashboard
```http
GET /v1/ops/dashboard
Authorization: Bearer <token>
```

**Response**:
```json
{
  "active_trips": 5,
  "missing_gear": 2,
  "compliance_issues_open": 1,
  "hazard_count": 3,
  "recent_incidents": [
    {
      "case_id": "case_123",
      "category": "EQUIPMENT_FAILURE",
      "severity": "MEDIUM",
      "trip_id": "trip_456"
    }
  ]
}
```

#### Get Trip State
```http
GET /v1/ops/trip/{tripId}/state
Authorization: Bearer <token>
```

**Response**:
```json
{
  "trip": {
    "trip_id": "trip_456",
    "status": "ACTIVE",
    "mode": "OFFSHORE",
    "start_time": "2024-01-01T00:00:00Z",
    "vessel_id": "vessel_789"
  },
  "gear": [
    {
      "gear_id": "gear_123",
      "type": "CRAB_POT",
      "status": "SET",
      "location": {"lat": 55.5, "lon": -165.2}
    }
  ],
  "hazards": [
    {
      "hazard_id": "hazard_456",
      "type": "HEAVY_SEAS",
      "severity": "HIGH",
      "description": "6-8 foot seas expected"
    }
  ],
  "compliance": {
    "checkpoints_passed": 8,
    "checkpoints_total": 10,
    "last_check": "2024-01-01T02:00:00Z"
  }
}
```

### Safety Service

#### Calculate Risk Score
```http
POST /v1/safety/risk/score
Content-Type: application/json
Authorization: Bearer <token>

{
  "mode": "OFFSHORE",
  "workload_intensity": 7,
  "weather_severity": 5,
  "near_miss_count": 1,
  "daylight_hours_left": 4,
  "solo_operator": false,
  "checkin_misses": 0
}
```

**Response**:
```json
{
  "score": 65,
  "tier": "MODERATE",
  "rationale": [
    "Moderate weather conditions",
    "Recent near-miss incident",
    "Limited daylight remaining"
  ],
  "mitigations": [
    "Increase weather monitoring",
    "Review safety procedures",
    "Consider early return if conditions worsen"
  ]
}
```

#### Report Incident
```http
POST /v1/safety/incident
Content-Type: application/json
Authorization: Bearer <token>

{
  "case_id": "case_789",
  "trip_id": "trip_456",
  "category": "PERSONNEL_INJURY",
  "severity": "HIGH",
  "summary": "Crew member slipped on deck, minor injury",
  "action_taken": "First aid administered, continued monitoring"
}
```

### Gear Service

#### Get Gear for Trip
```http
GET /v1/gear/trip/{tripId}?mode=OFFSHORE
Authorization: Bearer <token>
```

**Response**:
```json
{
  "trip_id": "trip_456",
  "mode": "OFFSHORE",
  "gear": [
    {
      "gear_id": "gear_123",
      "type": "CRAB_POT",
      "status": "SET",
      "set_time": "2024-01-01T01:00:00Z",
      "location": {"lat": 55.5, "lon": -165.2},
      "depth": 45,
      "soak_time": 7200
    }
  ]
}
```

### AI Service

AIS AI endpoints are authenticated and bounded for operational predictability. Request bodies are limited to 64 KiB. Risk assessment accepts at most 25 vessels per request, and behavior analysis accepts at most 500 observations. When `OPENROUTER_API_KEY` is not configured, or the upstream model call fails or times out, the API returns deterministic local fallback analysis with `ai_enhanced: false`.

#### Risk Assessment
```http
POST /v1/ais/risk/assess
Content-Type: application/json
Authorization: Bearer <token>

{
  "vessels": [
    {
      "mmsi": "368207620",
      "name": "F/V ARCTIC QUEEN",
      "latitude": 55.5,
      "longitude": -165.2,
      "speed": 2.5,
      "course": 45
    }
  ],
  "weather": {
    "wave_height": 1.8,
    "wind_speed": 5,
    "temperature": 2
  },
  "fishing_zone": {
    "lat": 55.5,
    "lon": -165.2,
    "radius": 10
  }
}
```

**Response**:
```json
{
  "assessments": [
    {
      "vessel_id": "368207620",
      "risk_level": "MODERATE",
      "factors": [
        "Moderate weather conditions",
        "Proximity to other vessels",
        "Gear deployment in progress"
      ],
      "recommendation": "Monitor weather closely, maintain safe distance",
      "confidence": 0.85
    }
  ]
}
```

#### AI Recommendations
```http
POST /v1/ais/ai/recommendations
Content-Type: application/json
Authorization: Bearer <token>

{
  "trip_data": {
    "catch_rate": 85,
    "gear_depth": 75,
    "current_grid": "8A",
    "sync_latency": 45
  },
  "weather": {
    "wave_height": 1.8,
    "wind_speed": 5,
    "temperature": 2
  },
  "vessels": [...],
  "fishing_zone": {...}
}
```

**Response**:
```json
{
  "recommendations": [
    {
      "id": "rec_123",
      "type": "OPERATIONAL",
      "priority": "MEDIUM",
      "message": "Consider moving to grid 8B for better catch rates",
      "action": "Relocate fishing grounds",
      "confidence": 0.78
    }
  ]
}
```

## Error Handling

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": {
      "field": "trip_id",
      "issue": "Required field missing"
    },
    "request_id": "req_123456"
  }
}
```

### Common Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VALIDATION_ERROR` | Invalid request payload | 400 |
| `UNAUTHORIZED` | Invalid or missing auth | 401 |
| `FORBIDDEN` | Insufficient permissions | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `CONFLICT` | Data conflict | 409 |
| `RATE_LIMITED` | Too many requests | 429 |
| `INTERNAL_ERROR` | Server error | 500 |

## Rate Limiting

All `/v1/*` routes are throttled by client address, route, and token fingerprint. Defaults are 120 requests per 60-second window and can be tuned with `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_SECONDS`. Production deployments use the `RATE_LIMITER` Durable Object binding for cross-isolate coordination.

### Register Current User Device

```http
POST /v1/sync/device/register-self
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "device_id": "mobile_crew_1_abcd1234",
  "public_key": "<base64url-ed25519-public-key>",
  "key_version": 1
}
```

Registers the caller's own `USER` device signing key. The API derives `tenant_id`, `subject_id`, and actor metadata from the authenticated session; clients cannot use this endpoint to register keys for another user, vessel, group, or organization.

Responses include `ratelimit-limit`, `ratelimit-remaining`, and `ratelimit-reset`; limited requests return HTTP `429` with `retry-after`.

## Pagination

Cursor-based pagination for large datasets:

```http
GET /v1/ops/trips?cursor=2024-01-01T00:00:00Z&limit=50
```

## Webhooks

### Event Webhooks
Configure webhooks to receive real-time event notifications:

```http
POST /v1/webhooks/register
Content-Type: application/json

{
  "url": "https://your-service.com/webhook",
  "events": ["TRIP_STARTED", "INCIDENT_OPENED"],
  "secret": "webhook_secret"
}
```

## SDK Examples

### JavaScript/TypeScript
```typescript
import { NorthlineAPI } from '@northline/client';

const api = new NorthlineAPI({
  baseURL: 'http://127.0.0.1:8787',
  token: '<local-dev-token>'
});

// Get dashboard
const dashboard = await api.getDashboard();

// Upload events
const result = await api.uploadEvents(events);

// Get trip state
const tripState = await api.getTripState('trip_456');
```

### Python
```python
from northline_client import NorthlineAPI

api = NorthlineAPI(
    base_url='http://127.0.0.1:8787',
    token='<local-dev-token>'
)

# Get dashboard
dashboard = api.get_dashboard()

# Upload events
result = api.upload_events(events)
```

## Testing

### Local Testing
```bash
# Start local API
cd api
pnpm dev

# Test endpoints
curl -H "Authorization: Bearer <local-dev-token>" \
  http://localhost:8787/v1/ops/dashboard
```

### Integration Tests
```typescript
// Example test
import { test, expect } from 'vitest';

test('GET /v1/ops/dashboard', async () => {
  const response = await fetch('/v1/ops/dashboard', {
    headers: { 'Authorization': 'Bearer <local-dev-token>' }
  });

  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toHaveProperty('active_trips');
});
```

## Versioning

API versioning follows semantic versioning:
- **v1**: Current stable version
- **v2**: Next major version (breaking changes)

Version specified in URL path: `/v1/`, `/v2/`

## Support

For API support:
- **Documentation**: `/docs/API_CONTRACTS.md`
- **Issues**: GitHub Issues
- **Email**: api-support@northline.fishing
