-- Scope remaining tenant-owned natural IDs by tenant (follow-up to 0009).
-- catch_rollups and stl_packet_queue were keyed on globally unique bare IDs,
-- which allowed cross-tenant upsert collisions on shared natural IDs.
-- Tables with nullable tenant_id global templates (ruleset, risk_policy,
-- training_module) intentionally keep their global primary keys; their
-- upserts are tenant-guarded in the API layer instead.

alter table if exists catch_rollups drop constraint if exists catch_rollups_pkey;
alter table if exists catch_rollups add constraint catch_rollups_pkey primary key (tenant_id, rollup_id);

alter table if exists stl_packet_queue drop constraint if exists stl_packet_queue_pkey;
alter table if exists stl_packet_queue add constraint stl_packet_queue_pkey primary key (tenant_id, packet_id);
