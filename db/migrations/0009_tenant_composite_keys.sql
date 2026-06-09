-- Scope tenant-owned natural IDs by tenant to prevent cross-tenant collisions.
-- Tables with nullable tenant_id global templates are intentionally excluded.

alter table if exists trip_state drop constraint if exists trip_state_pkey;
alter table if exists trip_state add constraint trip_state_pkey primary key (tenant_id, trip_id);

alter table if exists gear_state_offshore drop constraint if exists gear_state_offshore_pkey;
alter table if exists gear_state_offshore add constraint gear_state_offshore_pkey primary key (tenant_id, gear_id);

alter table if exists gear_state_ice drop constraint if exists gear_state_ice_pkey;
alter table if exists gear_state_ice add constraint gear_state_ice_pkey primary key (tenant_id, gear_id);

alter table if exists compliance_state drop constraint if exists compliance_state_pkey;
alter table if exists compliance_state add constraint compliance_state_pkey primary key (tenant_id, pkg_id);

alter table if exists lot_state drop constraint if exists lot_state_pkey;
alter table if exists lot_state add constraint lot_state_pkey primary key (tenant_id, lot_id);

alter table if exists lot_certificate drop constraint if exists lot_certificate_pkey;
alter table if exists lot_certificate add constraint lot_certificate_pkey primary key (tenant_id, certificate_id);

alter table if exists hazard_layer_state drop constraint if exists hazard_layer_state_pkey;
alter table if exists hazard_layer_state add constraint hazard_layer_state_pkey primary key (tenant_id, hazard_id);

alter table if exists safety_case drop constraint if exists safety_case_pkey;
alter table if exists safety_case add constraint safety_case_pkey primary key (tenant_id, case_id);

alter table if exists training_state drop constraint if exists training_state_pkey;
alter table if exists training_state add constraint training_state_pkey primary key (tenant_id, assign_id);

alter table if exists artifact_registry drop constraint if exists artifact_registry_pkey;
alter table if exists artifact_registry add constraint artifact_registry_pkey primary key (tenant_id, artifact_id);

alter table if exists integration_config drop constraint if exists integration_config_pkey;
alter table if exists integration_config add constraint integration_config_pkey primary key (tenant_id, integration_id);

alter table if exists sync_device drop constraint if exists sync_device_pkey;
alter table if exists sync_device add constraint sync_device_pkey primary key (tenant_id, device_id);

alter table if exists checkin_state drop constraint if exists checkin_state_pkey;
alter table if exists checkin_state add constraint checkin_state_pkey primary key (tenant_id, checkin_id);

alter table if exists lot_scan_batch drop constraint if exists lot_scan_batch_pkey;
alter table if exists lot_scan_batch add constraint lot_scan_batch_pkey primary key (tenant_id, batch_id);

alter table if exists catch_record drop constraint if exists catch_record_pkey;
alter table if exists catch_record add constraint catch_record_pkey primary key (tenant_id, catch_id);

alter table if exists station_state drop constraint if exists station_state_pkey;
alter table if exists station_state add constraint station_state_pkey primary key (tenant_id, station_id);

alter table if exists route_point drop constraint if exists route_point_pkey;
alter table if exists route_point add constraint route_point_pkey primary key (tenant_id, point_id);

alter table if exists return_plan drop constraint if exists return_plan_pkey;
alter table if exists return_plan add constraint return_plan_pkey primary key (tenant_id, plan_id);
