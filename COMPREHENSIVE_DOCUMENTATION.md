# Northline Platform - Comprehensive Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Applications](#applications)
4. [API Backend](#api-backend)
5. [Database Schema](#database-schema)
6. [Event System](#event-system)
7. [Sync Engine](#sync-engine)
8. [Security & Access Control](#security--access-control)
9. [Development Guide](#development-guide)
10. [Deployment](#deployment)
11. [Monitoring & Operations](#monitoring--operations)

---

## Overview

Northline is an **offline-first operations platform** designed for commercial fishing operations with two primary modes:

### Offshore Commercial King Crab Fishing
- Vessel-based operations in the Bering Sea
- Complex gear management and tracking
- Regulatory compliance and traceability
- Safety-critical environment monitoring

### Ice Fishing Operations
- Mobile-first ice fishing safety management
- Real-time weather and ice condition monitoring
- Solo operator safety protocols
- Emergency response workflows

### Key Features
- **Offline-first architecture** with intelligent sync
- **Event-driven data model** with immutable audit trails
- **Role-based access control** with tenant isolation
- **AI-powered risk assessment** and recommendations
- **Real-time fleet tracking** with AIS integration
- **Comprehensive safety management** with incident tracking
- **Gear lifecycle management** with sweep checks
- **Regulatory compliance** with certificate generation

---

## Architecture

### Monorepo Structure
```
northline/
  apps/                    # Frontend applications
    web-portal/            # Fleet management portal
    mobile-ops/            # Phone-first offshore + ice field UI
    tablet-ops/            # Vessel bridge/deck tablet UI
  api/                     # Cloudflare Worker API backend
  packages/                # Shared libraries
    shared/                # Event schemas, utilities
  db/                      # Database migrations and schemas
  docs/                    # Technical specifications
```

### Technology Stack

#### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **PWA** capabilities with Workbox
- **Tailwind CSS** for styling
- **Chart.js** for data visualization

#### Backend
- **Cloudflare Workers** for serverless API
- **Neon PostgreSQL** for database
- **Hono** for web framework
- **Zod** for schema validation
- **Jose** for JWT handling

#### Infrastructure
- **R2** for artifact storage
- **D1** for local development
- **Turbo** for monorepo management
- **PNPM** for package management

---

## Applications

### 1. Web Portal (`apps/web-portal`)

**Purpose**: Fleet management and operations hub for fleet managers, processors, and organizers

**Key Features**:
- Real-time fleet visualization with AIS tracking
- Trip management and compliance monitoring
- Risk assessment dashboard with AI recommendations
- Gear health monitoring and sweep management
- Safety incident tracking and response
- Export generation and certificate verification
- Sync health monitoring

**Technical Details**:
- Runs on `http://localhost:5173` (development)
- PWA with offline capabilities
- Responsive design for desktop and tablet
- Real-time updates via WebSocket connections

**Main Components**:
```typescript
// Core dashboard views
- FleetMap: Real-time vessel tracking
- RiskHeatMap: Risk assessment visualization
- TripTimeline: Trip progress tracking
- GearHealthDashboard: Gear status monitoring
- ComplianceProgress: Regulatory compliance
- SyncHealthMonitor: Sync status overview
```

**AI Integration**:
- OpenRouter AI model hierarchy for risk assessment
- Real-time collision prediction
- Weather-based recommendations
- Model fallback system with logging

### 2. Mobile Ops (`apps/mobile-ops`)

**Purpose**: Unified field app for offshore and ice crews on phones and small tablets

**Key Features**:
- Safety gate and check-in workflows
- Hazard reporting and shared hazard feed
- Gear transitions and trip operations
- Training recommendations
- Offline queue controls and shift notes

**Technical Details**:
- Runs on `http://localhost:5174` (development)
- Mobile-first responsive design
- PWA with offline-capable build output

### 3. Tablet Ops (`apps/tablet-ops`)

**Purpose**: Vessel-mounted tablet for offshore king crab operations

**Key Features**:
- Active trip selection and vessel status
- Gear status and transition controls
- MOB and all-hands safety actions
- Bridge log and connected-device state
- Live risk context

**Technical Details**:
- Runs on `http://localhost:5175` (development)
- Optimized for tablet interfaces
- Robust offline support

---

## API Backend

### Core Services

#### 1. Sync Service (`/v1/sync/*`)
**Purpose**: Event synchronization between devices and cloud

**Endpoints**:
```typescript
POST /v1/sync/upload          // Upload events from devices
GET  /v1/sync/download         // Download events since cursor
POST /v1/sync/ack             // Acknowledge received events
POST /v1/sync/metrics         // Upload device metrics
GET  /v1/sync/devices         // List registered devices
POST /v1/sync/device/register // Register new device
```

**Key Features**:
- Event deduplication by event_id
- Hash chain verification
- Cursor-based pagination
- Conflict resolution
- Device health metrics

#### 2. Operations Service (`/v1/ops/*`)
**Purpose**: Trip and operations management

**Endpoints**:
```typescript
GET  /v1/ops/dashboard         // Operations overview
GET  /v1/ops/trips            // List trips
GET  /v1/ops/trip/:id/state   // Trip state details
GET  /v1/ops/trip/:id/timeline // Trip timeline
POST /v1/ops/trip/:id/compliance/sign // Sign compliance
```

#### 3. Safety Service (`/v1/safety/*`)
**Purpose**: Safety management and risk assessment

**Endpoints**:
```typescript
POST /v1/safety/risk/score    // Calculate risk score
POST /v1/safety/incident      // Report incident
GET  /v1/safety/incidents/open // List open incidents
POST /v1/safety/hazard/report // Report hazard
```

#### 4. Gear Service (`/v1/gear/*`)
**Purpose**: Gear lifecycle management

**Endpoints**:
```typescript
GET  /v1/gear/trip/:tripId    // Get gear for trip
POST /v1/gear/register        // Register new gear
PUT  /v1/gear/:id/status      // Update gear status
```

#### 5. Rules Service (`/v1/rules/*`)
**Purpose**: Ruleset and policy management

**Endpoints**:
```typescript
GET  /v1/rules/all            // List rulesets
POST /v1/rules/upsert         // Create/update ruleset
GET  /v1/rules/evaluate       // Evaluate rules against context
```

#### 6. Export Service (`/v1/export/*`)
**Purpose**: Export and compliance package generation

**Endpoints**:
```typescript
POST /v1/export/compliance-package // Generate compliance export
GET  /v1/export/artifact/:id      // Download export artifact
```

### AI Integration

#### OpenRouter Model Hierarchy
```typescript
const MODEL_FALLBACK = [
  "openrouter/aurora-alpha",           // Primary model
  "stepfun/step-3.5-flash:free",     // Free fallback
  "anthropic/claude-opus-4.5",        // High-end fallback
  "openai/gpt-oss-safeguard-20b:nitro" // Final fallback
];
```

#### AI Endpoints
```typescript
POST /v1/ais/risk/assess           // AI risk assessment
POST /v1/ais/ai/recommendations   // AI recommendations
POST /v1/ais/ai/collision-prediction // Collision prediction
POST /v1/ais/ai/behavior          // Vessel behavior analysis
```

---

## Database Schema

### Core Tables

#### Events Table
```sql
CREATE TABLE ops_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  device_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  hash_chain TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Trips Table
```sql
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  vessel_id TEXT,
  mode TEXT NOT NULL, -- OFFSHORE | ICE
  status TEXT NOT NULL, -- PLANNED | ACTIVE | COMPLETED | CANCELLED
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Gear Table
```sql
CREATE TABLE gear (
  gear_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  trip_id TEXT REFERENCES trips(trip_id),
  gear_type TEXT NOT NULL,
  status TEXT NOT NULL, -- REGISTERED | SET | HAULED | MISSING
  location JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Safety Incidents Table
```sql
CREATE TABLE safety_cases (
  case_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  trip_id TEXT REFERENCES trips(trip_id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL, -- OPEN | INVESTIGATING | CLOSED
  summary TEXT,
  actions_taken JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Views and Projections

#### Trip State View
```sql
CREATE VIEW trip_state AS
SELECT
  t.trip_id,
  t.status,
  COUNT(DISTINCT g.gear_id) as gear_count,
  COUNT(DISTINCT sc.case_id) as incident_count,
  MAX(e.timestamp) as last_activity
FROM trips t
LEFT JOIN gear g ON t.trip_id = g.trip_id
LEFT JOIN safety_cases sc ON t.trip_id = sc.trip_id
LEFT JOIN ops_events e ON t.trip_id = e.payload->>'trip_id'
GROUP BY t.trip_id, t.status;
```

---

## Event System

### Event Types

#### Trip Lifecycle Events
```typescript
TRIP_PLANNED
TRIP_STARTED
TRIP_ENDED
TRIP_CANCELLED
TRIP_NOTE_ADDED
TRIP_OWNER_TRANSFERRED
```

#### Safety Events
```typescript
SAFETY_BRIEFING_COMPLETED
SAFETY_PROMPT_ACKED
INCIDENT_OPENED
INCIDENT_UPDATED
INCIDENT_CLOSED
NEAR_MISS_RECORDED
STOP_WORK_TRIGGERED
MOB_WORKFLOW_STARTED
```

#### Gear Events
```typescript
GEAR_REGISTERED
GEAR_SET
GEAR_CHECKED
GEAR_HAULED
GEAR_MARKED_MISSING
GEAR_RECOVERED
GEAR_SWEEP_CONFIRMED
```

#### Compliance Events
```typescript
COMPLIANCE_CHECKPOINT_PASSED
COMPLIANCE_CHECKPOINT_FAILED
COMPLIANCE_PACKAGE_ISSUED
CERTIFICATE_VERIFIED
```

### Event Schema
```typescript
interface OpsEvent {
  event_id: string;           // ULID
  tenant_id: string;
  event_type: string;
  event_version: number;
  payload: Record<string, any>;
  device_id?: string;
  timestamp: string;          // ISO 8601
  hash_chain?: string;        // Previous event hash
  signature?: string;         // Device signature
}
```

---

## Sync Engine

### Sync Protocol

#### Upload Flow
1. Client collects events locally
2. Batch upload to `/v1/sync/upload`
3. Server validates and deduplicates events
4. Server returns new cursor and server-generated events
5. Client updates local cursor

#### Download Flow
1. Client requests events since last cursor
2. Server returns paginated event stream
3. Client applies events to local state
4. Client acknowledges receipt

#### Conflict Resolution
- **Last Write Wins** for most events
- **Business rules** for critical operations
- **Manual resolution** for data conflicts

### Offline Support

#### Local Storage
- IndexedDB for event persistence
- Service worker for background sync
- Local state management with Redux

#### Sync Strategies
- **Immediate sync** when online
- **Batch sync** for large datasets
- **Delta sync** for incremental updates
- **Conflict detection** and resolution

---

## Security & Access Control

### Authentication

#### Development Mode
```typescript
Authorization: Bearer demoTenant:portal_admin:OWNER
```

#### Production Mode
```typescript
Authorization: Bearer <JWT_TOKEN>
```

### Authorization Model

#### Roles
- **OWNER**: Full system access
- **ADMIN**: Fleet management
- **SUPERVISOR**: Trip oversight
- **OPERATOR**: Vessel operations
- **VIEWER**: Read-only access

#### Permissions
- **Tenant isolation** by tenant_id
- **Resource-based** access control
- **Row-level security** in PostgreSQL
- **API route protection**

### Data Protection

#### Encryption
- **TLS 1.3** for all API communication
- **AES-256** for sensitive data at rest
- **Device signatures** for event integrity

#### Privacy
- **PII minimization** in event payloads
- **Data retention** policies
- **Right to deletion** compliance

---

## Development Guide

### Getting Started

#### Prerequisites
- Node.js 18+
- PNPM package manager
- Docker (optional for local DB)

#### Installation
```bash
# Clone repository
git clone <repository-url>
cd northline

# Install dependencies
pnpm install

# Start development servers
pnpm dev
```

#### Development Servers
- **Web Portal**: http://localhost:5173
- **Mobile Ops**: http://localhost:5174
- **Tablet Ops**: http://localhost:5175
- **API Backend**: http://localhost:8787

### Code Organization

#### Shared Packages
```typescript
packages/shared/
  - events/          // Event schemas
  - sync/           // Sync utilities
  - auth/           // Auth helpers
  - types/          // Common types
```

#### Frontend Structure
```typescript
apps/web-portal/src/
  - components/     // React components
  - hooks/         // Custom hooks
  - lib/           // API clients
  - types/         // TypeScript types
  - utils/         // Utility functions
```

#### API Structure
```typescript
api/src/
  - routes/        // API endpoints
  - lib/           // Database clients
  - middleware/    // Auth/validation
  - types/         // API schemas
```

### Testing

#### Unit Tests
```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm test --filter @northline/api
```

#### Integration Tests
- API endpoint testing
- Database integration
- Sync workflow testing

#### E2E Tests
- Cross-app workflows
- Offline sync scenarios
- Safety incident simulations

### Environment Variables

#### Development
```bash
# API Configuration
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_DEV_TOKEN=demoTenant:portal_admin:OWNER

# Database
NEON_DATABASE_URL=postgresql://...
```

#### Production
```bash
# Authentication
JWT_PUBLIC_KEY=your_jwt_public_key
CORS_ORIGIN=https://your-web-origin.example

# Storage
R2_BUCKET=northline-artifacts

# Monitoring
SENTRY_DSN=your_sentry_dsn
```

Production browser builds must not ship static bearer tokens through `VITE_*` variables. The frontend clients expect a runtime token in `sessionStorage` or `localStorage` under `northline.apiToken` until a dedicated sign-in shell is added.

---

## Deployment

### Production Architecture

#### Cloudflare Workers
- **API**: Global edge deployment
- **Cron**: Scheduled tasks
- **KV**: Configuration storage
- **R2**: File storage

#### Neon Database
- **Primary**: Read-write operations
- **Read replicas**: Analytics queries
- **Branching**: Preview environments

#### Frontend Deployment
- **Static hosting**: Vercel/Netlify
- **CDN**: Global distribution
- **PWA**: Offline capabilities

### Deployment Process

#### API Deployment
```bash
# Deploy to Cloudflare Workers
cd api
pnpm build
wrangler deploy
```

#### Frontend Deployment
```bash
# Build and deploy
cd apps/web-portal
pnpm build
# Deploy to hosting provider
```

#### Database Migrations
```bash
# Run migrations
cd db
pnpm migrate
```

### Monitoring

#### Application Metrics
- **Response times**: API performance
- **Error rates**: Failure tracking
- **Usage metrics**: Feature adoption
- **Sync health**: Device connectivity

#### Infrastructure Monitoring
- **Worker metrics**: CPU/memory usage
- **Database performance**: Query optimization
- **Storage usage**: Artifact management
- **Network latency**: Global performance

---

## Monitoring & Operations

### Health Checks

#### API Health
```typescript
GET /health
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0",
  "database": "connected",
  "services": {
    "sync": "healthy",
    "ai": "healthy",
    "storage": "healthy"
  }
}
```

#### Sync Health
```typescript
GET /v1/sync/health
{
  "active_devices": 42,
  "pending_uploads": 3,
  "sync_latency": "2.3s",
  "error_rate": "0.1%"
}
```

### Logging

#### Structured Logging
```typescript
// API logs
{
  "timestamp": "2024-01-01T00:00:00Z",
  "level": "info",
  "service": "api",
  "tenant_id": "tenant_123",
  "request_id": "req_456",
  "method": "POST",
  "path": "/v1/sync/upload",
  "duration_ms": 234,
  "status": 200
}
```

#### Error Tracking
- **Sentry** for error aggregation
- **Contextual data** for debugging
- **Performance traces** for optimization

### Alerting

#### Critical Alerts
- **API downtime**: Service unavailable
- **Database failures**: Connection issues
- **Sync failures**: Data loss prevention
- **Safety incidents**: Immediate notification

#### Warning Alerts
- **High latency**: Performance degradation
- **Error rate spikes**: Quality issues
- **Storage limits**: Capacity planning
- **Device offline**: Connectivity issues

### Backup & Recovery

#### Database Backups
- **Point-in-time recovery**: 7-day retention
- **Cross-region replication**: Disaster recovery
- **Export capabilities**: Compliance requirements

#### Event Archive
- **Long-term storage**: Historical analysis
- **Compression**: Cost optimization
- **Access controls**: Privacy protection

---

## Troubleshooting

### Common Issues

#### Sync Problems
1. **Device offline**: Check network connectivity
2. **Cursor mismatch**: Reset sync state
3. **Event conflicts**: Review conflict logs
4. **Storage full**: Clear local cache

#### Performance Issues
1. **Slow queries**: Check database indexes
2. **Memory leaks**: Monitor worker memory
3. **Large payloads**: Implement pagination
4. **Concurrent users**: Scale horizontally

#### AI Integration
1. **Model failures**: Check OpenRouter status
2. **Rate limits**: Implement backoff
3. **Invalid responses**: Validate schemas
4. **High latency**: Use local fallbacks

### Debug Tools

#### API Debugging
```bash
# Check API health
curl http://localhost:8787/health

# View sync status
curl -H "Authorization: Bearer demoTenant:portal_admin:OWNER" \
  http://localhost:8787/v1/sync/health
```

#### Frontend Debugging
- **React DevTools**: Component inspection
- **Redux DevTools**: State management
- **Network tab**: API requests
- **Console**: Error logs

#### Database Debugging
```sql
-- Check recent events
SELECT * FROM ops_events
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC;

-- Check sync status
SELECT device_id, MAX(timestamp) as last_sync
FROM ops_events
GROUP BY device_id;
```

---

## Future Roadmap

### Planned Features

#### Enhanced AI Capabilities
- **Predictive maintenance**: Equipment failure prediction
- **Route optimization**: Fuel efficiency recommendations
- **Crew scheduling**: Fatigue management
- **Market integration**: Price forecasting

#### Mobile Enhancements
- **Native apps**: iOS/Android applications
- **Offline maps**: Chart display without internet
- **Voice commands**: Hands-free operation
- **AR integration**: Gear visualization

#### Compliance Automation
- **Electronic reporting**: Direct agency submission
- **Automated certificates**: Real-time generation
- **Audit trails**: Complete compliance history
- **Regulatory updates**: Automatic rule changes

#### Analytics Platform
- **Business intelligence**: Advanced dashboards
- **Fleet optimization**: Performance analytics
- **Safety insights**: Incident pattern analysis
- **Resource planning**: Capacity management

### Technical Improvements

#### Performance
- **Edge computing**: Regional processing
- **Caching strategy**: Multi-layer caching
- **Database optimization**: Query performance
- **Bundle optimization**: Faster load times

#### Reliability
- **Multi-region deployment**: Global redundancy
- **Circuit breakers**: Fault isolation
- **Health monitoring**: Proactive detection
- **Disaster recovery**: Business continuity

#### Security
- **Zero-trust architecture**: Enhanced security model
- **Hardware tokens**: Multi-factor authentication
- **Data encryption**: End-to-end encryption
- **Compliance frameworks**: Industry standards

---

## Support & Community

### Getting Help

#### Documentation
- **API docs**: `/docs/API_CONTRACTS.md`
- **Event catalog**: `/docs/EVENT_CATALOG.md`
- **Sync specification**: `/docs/SYNC_SPEC.md`
- **Security guide**: `/docs/SECURITY.md`

#### Support Channels
- **GitHub issues**: Bug reports and feature requests
- **Discord community**: User discussions
- **Email support**: Enterprise support
- **Documentation**: Technical guides

### Contributing

#### Development Workflow
1. **Fork repository**: Create development branch
2. **Write tests**: Ensure code quality
3. **Submit PR**: Code review process
4. **Merge changes**: Continuous integration
5. **Release**: Version management

#### Code Standards
- **TypeScript**: Strict typing
- **ESLint**: Code formatting
- **Prettier**: Style consistency
- **Husky**: Pre-commit hooks

### License

This project is licensed under the **MIT License** - see the LICENSE file for details.

---

*Last updated: January 2025*
*Version: 1.0.0*
