# MCP Tool Schemas

These schemas define Rapid Handoff's MCP-facing domain tools. Agents call these
tool contracts instead of direct MongoDB or Arize/Phoenix clients.

## `get_available_beds`

Returns ER beds that are available, clean, and optionally match type/monitor
requirements.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "get_available_beds",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "bedType": {
      "type": "string",
      "enum": ["trauma", "exam", "observation", "isolation", "pediatric"]
    },
    "requiresMonitor": {
      "type": "boolean"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 20
    }
  }
}
```

Expected response shape:

```json
{
  "beds": [
    {
      "bedId": "B-003",
      "room": "ER-102",
      "type": "exam",
      "hasMonitor": true,
      "status": "available"
    }
  ],
  "count": 1
}
```

## `assign_patient_to_bed`

Assigns a patient to a bed and updates both patient and bed operational state.
This must be implemented as an atomic MCP-backed write flow.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "assign_patient_to_bed",
  "type": "object",
  "additionalProperties": false,
  "required": ["patientId", "bedId", "assignedByStaffId"],
  "properties": {
    "patientId": {
      "type": "string",
      "minLength": 1
    },
    "bedId": {
      "type": "string",
      "minLength": 1
    },
    "assignedByStaffId": {
      "type": "string",
      "minLength": 1
    },
    "expectedBedVersion": {
      "type": "integer",
      "minimum": 0,
      "description": "Optional optimistic concurrency version."
    }
  }
}
```

Expected response shape:

```json
{
  "status": "assigned",
  "patientId": "P-0001",
  "bedId": "B-003",
  "eventId": "EVT-0042"
}
```

## `get_available_staff`

Returns available ER staff filtered by role and/or shift.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "get_available_staff",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["physician", "nurse", "charge_nurse", "paramedic", "tech"]
      },
      "uniqueItems": true
    },
    "shift": {
      "type": "string",
      "enum": ["day", "evening", "night"]
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 20
    }
  }
}
```

Expected response shape:

```json
{
  "staff": [
    {
      "staffId": "S-002",
      "name": "Rachel Green",
      "role": "nurse",
      "shift": "evening",
      "available": true
    }
  ],
  "count": 1
}
```

## `update_supply_inventory`

Applies a signed inventory delta for an ER supply item. Use an idempotency key
so retried agent runs do not double-count usage.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "update_supply_inventory",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "supplyId",
    "quantityDelta",
    "reason",
    "updatedByStaffId",
    "idempotencyKey"
  ],
  "properties": {
    "supplyId": {
      "type": "string",
      "minLength": 1
    },
    "quantityDelta": {
      "type": "integer",
      "description": "Positive for restock, negative for usage."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "updatedByStaffId": {
      "type": "string",
      "minLength": 1
    },
    "idempotencyKey": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

Expected response shape:

```json
{
  "status": "updated",
  "supplyId": "SUP-004",
  "previousQuantity": 40,
  "newQuantity": 35,
  "eventId": "EVT-0043"
}
```

## `log_arize_trace`

Logs an agent/tool decision event through the Arize/Phoenix MCP integration
layer. This is intentionally an MCP-facing contract; agents must not call
Phoenix REST or OTLP endpoints directly.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "log_arize_trace",
  "type": "object",
  "additionalProperties": false,
  "required": ["traceId", "operation", "agent", "status", "startedAt"],
  "properties": {
    "traceId": {
      "type": "string",
      "minLength": 1
    },
    "operation": {
      "type": "string",
      "minLength": 1
    },
    "agent": {
      "type": "string",
      "minLength": 1
    },
    "status": {
      "type": "string",
      "enum": ["ok", "error"]
    },
    "startedAt": {
      "type": "string",
      "format": "date-time"
    },
    "endedAt": {
      "type": "string",
      "format": "date-time"
    },
    "attributes": {
      "type": "object",
      "additionalProperties": true,
      "default": {}
    },
    "input": true,
    "output": true,
    "errorMessage": {
      "type": "string"
    }
  }
}
```

Expected response shape:

```json
{
  "status": "logged",
  "traceId": "trace-123",
  "project": "rapid-handoff-er"
}
```
