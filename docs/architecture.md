# Phase 2 Architecture: Agent Architecture and MCP Integration

Rapid Handoff keeps the existing Express Cloud Run backend and the existing
Vertex AI ADK `er_operations_orchestrator`. Phase 2 adds an MCP integration
layer that future sub-agents use to reach MongoDB and Arize/Phoenix without
opening direct database or observability clients inside agent logic.

## End-to-end flow

```text
Receptionist UI
  -> Express Cloud Run backend
  -> ER Orchestrator
  -> Sub-agents
  -> MCP-facing tools/adapters
  -> MongoDB MCP Server + Phoenix MCP Server
  -> MongoDB + Arize/Phoenix
  -> Staff Dashboard
```

The Receptionist UI submits operational requests such as patient intake,
bed search, staff availability, supply updates, and briefing generation. The
orchestrator interprets intent and delegates to sub-agents. Sub-agents call
domain tools only. Those domain tools are backed by MCP adapters, and the MCP
servers are the only integration boundary for persistence and observability.

The Staff Dashboard consumes the resulting state through application APIs and
shows bed assignments, staffing decisions, queue pressure, and operational
briefings.

## Orchestrator responsibilities

The orchestrator remains the traffic controller. It should:

- Classify the user request into ER operational domains.
- Choose which sub-agent or sub-agents should run.
- Preserve clinical safety boundaries and avoid diagnosis or treatment advice.
- Combine sub-agent outputs into a concise operational answer.
- Ensure state-changing actions go through auditable MCP tools.
- Ask for missing required fields before invoking write tools.
- Request Arize/Phoenix trace logging for important decisions and tool flows.

The orchestrator should not:

- Query MongoDB directly.
- Call Phoenix or Arize REST APIs directly.
- Embed database collection names or credentials in prompts.
- Override MCP server read/write safety configuration.

## Sub-agents

### Triage agent

Responsibilities:

- Summarize patient intake context and acuity signals.
- Identify high-priority waiting-room risks for operational review.
- Request bed/resource agent help when a patient appears ready for placement.
- Log decision context for downstream review.

Primary tools:

- `log_arize_trace`
- `get_available_staff`
- Domain read tools backed by MongoDB MCP queries.

### Bed/resource agent

Responsibilities:

- Find available beds that match operational constraints.
- Assign patients to beds after the orchestrator confirms required fields.
- Update supply counts when supplies are used or restocked.
- Keep bed state transitions atomic and auditable.

Primary tools:

- `get_available_beds`
- `assign_patient_to_bed`
- `update_supply_inventory`
- `log_arize_trace`

### Staff coordination agent

Responsibilities:

- Find available staff by role and shift.
- Recommend coverage changes based on workload, acuity, and queue pressure.
- Coordinate staff assignments with bed and triage needs.

Primary tools:

- `get_available_staff`
- `log_arize_trace`

### Reporting/analytics agent

Responsibilities:

- Build shift briefings and operational summaries.
- Explain bottlenecks using recent patient, bed, staff, and supply state.
- Prepare dashboard-ready summaries and trace metadata.

Primary tools:

- `get_available_beds`
- `get_available_staff`
- `log_arize_trace`

## MCP server responsibilities

### MongoDB MCP Server

Use the official MongoDB MCP Server (`mongodb-mcp-server`). It is responsible
for all database access. The server should be configured with scoped MongoDB
credentials and environment variables such as:

- `MDB_MCP_CONNECTION_STRING`
- `MDB_MCP_READ_ONLY`
- `MDB_MCP_INDEX_CHECK`
- `MDB_MCP_LOGGERS`

MongoDB's official MCP server exposes database tools including `find`,
`aggregate`, `count`, `insert-many`, `update-one`, and `update-many`. Rapid
Handoff's domain tools wrap those primitives behind ER-specific contracts so
agents do not need raw collection access.

### Arize/Phoenix MCP Server

Use the Phoenix MCP Server (`@arizeai/phoenix-mcp`). It is responsible for
observability workflows such as inspecting projects, traces, spans, sessions,
annotations, prompts, datasets, and experiments.

Environment-driven configuration:

- `PHOENIX_BASE_URL`
- `PHOENIX_MCP_URL`
- `PHOENIX_API_KEY`
- `PHOENIX_PROJECT`
- `PHOENIX_COLLECTOR_ENDPOINT`

The architecture uses a domain-level `log_arize_trace` MCP contract for agent
trace events. If the active Phoenix MCP deployment does not expose a write
trace tool, a thin MCP gateway should implement `log_arize_trace` and forward
trace payloads to Phoenix-compatible observability plumbing. Agents still call
only the MCP-facing tool.

## Tool schemas

The Phase 2 domain contracts are documented in
[mcp-tools.md](mcp-tools.md):

- `get_available_beds`
- `assign_patient_to_bed`
- `get_available_staff`
- `update_supply_inventory`
- `log_arize_trace`

The matching TypeScript adapters live in `backend/src/mcp`. They validate input
with Zod and call local stdio or remote HTTP MCP tools through the official
TypeScript MCP SDK. They do not hardcode secrets.

The production ER domain adapter builds intake, bed, and staff workflows on the
official MongoDB MCP `find` and `update-many` primitives. The server does not
expose cross-collection transactions, so bed and staff reservations use
conditional updates with compensating rollback when a later patient update
fails. Unique `patientId`, `bedId`, and `staffId` indexes remain required.

## Runtime configuration

The existing Cloud Run service remains the public backend. By default, the
application launches local stdio MCP servers with `npx`. Cloud Run
should provide secrets through Secret Manager rather than `.env` files.

Local stdio variables:

```bash
MONGODB_URI=<mongodb-connection-string>
PHOENIX_BASE_URL=https://app.phoenix.arize.com
PHOENIX_API_KEY=<secret-api-key>
```

Local MCP client configuration is captured in `mcp.json` for development.

## Safety notes

- Prefer read-only MongoDB MCP mode for reporting and analytics deployments.
- Enable write tools only for controlled operational flows such as bed
  assignment and supply updates.
- Keep idempotency keys on write tools.
- Log trace identifiers, tool inputs, outputs, and error summaries, but avoid
  storing unnecessary patient-identifying details in observability metadata.
- Do not expose MCP endpoints publicly without authentication.
