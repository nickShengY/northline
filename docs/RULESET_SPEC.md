# Ruleset and Policy Spec

## 1) Ruleset table

`ruleset` rows are mode + region + date scoped.

Fields:

- `ruleset_id`
- `tenant_id` nullable for global default
- `mode` (`OFFSHORE|ICE`)
- `region_code`
- `effective_from`, `effective_to`
- `priority` (lower is stronger)
- `rules_json`

## 2) Resolution precedence

For a `(tenant, mode, region, date)` lookup:

1. Tenant-scoped rows first
2. Global rows second (`tenant_id IS NULL`)
3. Then ascending `priority`
4. Then latest `effective_from`

## 3) Risk policy table

`risk_policy` stores scoring and prompt-escalation profiles.

Fields:

- `policy_id`
- `tenant_id` nullable for global default
- `mode` nullable for all-mode policy
- `policy_json`

## 4) Sample `rules_json`

```json
{
  "ice": {
    "max_tipups": 5,
    "min_check_interval_min": 20,
    "daily_possession_limit": {
      "northern_pike": 3
    }
  },
  "offshore": {
    "max_soak_hours": 72,
    "required_prehaul_checks": ["pinch_zone", "line_tension", "comms"]
  }
}
```

## 5) Versioning

- Rules are immutable snapshots in time.
- New regulation = insert new row with new date window/version metadata in `rules_json`.
