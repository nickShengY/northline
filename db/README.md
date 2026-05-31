# Northline DB

## Structure

- `migrations/0001_init.sql`: core event store + read models + config tables
- `migrations/0002_rls.sql`: strict tenant isolation and RLS policies
- `migrations/0003_extensions.sql`: cycle/catch rollups, training module catalog, integration config, sync observability
- `migrations/0004_workflows.sql`: check-in workflow state and lot scan ingestion batch audit table
- `migrations/0005_complete_schema.sql`: safety, MOB, briefing, station, and integration workflow state
- `migrations/0006_stl_packet_queue.sql`: semantic transport layer queue for weak-connectivity sync
- `migrations/0007_enterprise_hardening.sql`: tenant-scoped audit log for sensitive operations
- `seeds/rulesets.sql`: default offshore + ice operational rulesets and risk policies

## Migration order

1. `0001_init.sql`
2. `0002_rls.sql`
3. `0003_extensions.sql`
4. `0004_workflows.sql`
5. `0005_complete_schema.sql`
6. `0006_stl_packet_queue.sql`
7. `0007_enterprise_hardening.sql`
8. `seeds/rulesets.sql`

## Notes

- API sets `app.tenant_id` per request before SQL operations.
- All mutable operational views can be rebuilt from `ops_event`.
- Artifacts (certificates, exports, incident media) must be recorded in `artifact_registry` with content hash and provenance list.
