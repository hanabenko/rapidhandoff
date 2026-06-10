# Phase 3 Live Integration

The critical-patient demo defaults to mock mode and requires no live services.
Set `LIVE_MCP=true` only when you want the demo workflow to call live MCP
servers.

## Mock mode

Mock mode is the default and is what local tests use:

```bash
pnpm demo:critical-patient
```

This path uses deterministic fixtures for beds, staff, supplies, historical
cases, dashboard metrics, and Phoenix trace logging. It still validates all
five MCP-facing tool inputs with the same Zod schemas used by live mode.

```bash
LIVE_MCP=true pnpm demo:critical-patient
```

On PowerShell:

```powershell
$env:LIVE_MCP = "true"
pnpm demo:critical-patient
```

If required live configuration is missing, the command returns a structured
`configuration_error` result and does not attempt a write.

## Required environment variables

Local stdio MCP mode requires MongoDB configuration. Add the Phoenix values to
enable local Phoenix MCP tracing:

```bash
LIVE_MCP=true
MONGODB_URI=<mongodb-connection-string>
MONGODB_MCP_DATABASE=er_system
PHOENIX_API_KEY=<phoenix-api-key>
PHOENIX_BASE_URL=https://app.phoenix.arize.com
```

This launches:

```bash
npx -y mongodb-mcp-server@latest
npx -y @arizeai/phoenix-mcp@latest --baseUrl "$PHOENIX_BASE_URL" --apiKey "$PHOENIX_API_KEY"
```

The MongoDB subprocess receives `MDB_MCP_CONNECTION_STRING` from
`MONGODB_URI`. `MDB_MCP_READ_ONLY` and `MDB_MCP_INDEX_CHECK` remain optional.
Keep `MDB_MCP_INDEX_CHECK=false` when using the operations dashboard because
its bounded whole-collection snapshots are intentionally reported as
`COLLSCAN` query plans.

Phoenix/Arize OTLP tracing, if using the tracing SDK path:

```bash
PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com
PHOENIX_API_KEY=<phoenix-api-key>
PHOENIX_PROJECT=rapid-handoff-er
```

The live demo also accepts these aliases:

```bash
ARIZE_TRACING_ENDPOINT=https://app.phoenix.arize.com
ARIZE_API_KEY=<arize-or-phoenix-api-key>
ARIZE_PROJECT_NAME=rapid-handoff-er
```

If neither Phoenix MCP nor OTLP tracing variables are set, the workflow still
runs and returns `TRACE-LIVE-NOT-CONFIGURED` as a non-blocking trace marker.

## Verifying MongoDB writes

After a successful live run, verify the assignment and supply update through
MongoDB MCP or your MongoDB console:

- `beds`: the selected trauma bed should be occupied or otherwise marked by
  the `assign_patient_to_bed` domain tool.
- `patients`: patient `P-DEMO-001` should reflect the assigned bed if the live
  domain tool updates patient state.
- `supplies`: `Oxygen cannulas` should be decremented by 1 when the supply
  record exists.
- `events`: the live domain tools should record assignment and inventory events
  if your MCP gateway implements event writes.

The demo checks bed and staff availability before calling
`assign_patient_to_bed`, so no-bed and no-staff fallbacks avoid partial
assignment writes.

## Verifying Phoenix/Arize traces

For Phoenix MCP mode, check the Phoenix project configured by the MCP server for
the `critical_patient_live_workflow` trace or the returned `traceEventId`.

For OTLP tracing mode, open Phoenix/Arize and filter by:

- Project: `PHOENIX_PROJECT` or `ARIZE_PROJECT_NAME`
- Operation/span name: `critical_patient_live_workflow`
- Attribute: `rapid_handoff.trace_id = trace-live-critical-001`

Fallback cases log `critical_patient_live_fallback` when tracing is configured.
