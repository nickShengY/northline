insert into ruleset (ruleset_id, tenant_id, mode, region_code, effective_from, priority, rules_json)
values
(
  'offshore_default_v1',
  null,
  'OFFSHORE',
  'AK-BS',
  '2026-01-01',
  10,
  jsonb_build_object(
    'max_strings', 120,
    'max_soak_hours_warning', 72,
    'required_pretrip_steps', jsonb_build_array('PPE_CHECK', 'FATIGUE_PLAN', 'COMMS_CHECK'),
    'compliance_required_fields', jsonb_build_array('trip_start', 'trip_end', 'catch_total', 'area_log')
  )
),
(
  'ice_default_v1',
  null,
  'ICE',
  'US-GENERAL',
  '2026-01-01',
  10,
  jsonb_build_object(
    'max_tipups', 5,
    'check_interval_min', 30,
    'required_gear', jsonb_build_array('ice_spikes', 'throw_rope', 'floatation', 'comms'),
    'sharing_default', 'GROUP'
  )
)
on conflict (ruleset_id) do nothing;

insert into risk_policy (policy_id, tenant_id, mode, policy_json)
values
(
  'offshore_risk_default',
  null,
  'OFFSHORE',
  jsonb_build_object(
    'prompt_throttle_seconds', 120,
    'stop_work_threshold', 85,
    'near_miss_cluster_window_hours', 12,
    'near_miss_cluster_threshold', 3
  )
),
(
  'ice_risk_default',
  null,
  'ICE',
  jsonb_build_object(
    'checkin_grace_minutes', 10,
    'escalate_after_missed', 2,
    'return_by_reminder_minutes', 30
  )
)
on conflict (policy_id) do nothing;
