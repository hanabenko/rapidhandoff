import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
    approvedMcpToolNames,
    agentDefinitions,
    mcpToolNames,
    orchestratorRoutingRules,
    subAgentDefinitions,
} from "./definitions.js";
import { mcpToolSchemas } from "../mcp/schemas.js";

const validMcpInputs = {
    get_available_beds: {
        bedType: "exam",
        requiresMonitor: true,
        limit: 10,
    },
    assign_patient_to_bed: {
        patientId: "P-0001",
        bedId: "B-003",
        assignedByStaffId: "S-001",
        expectedBedVersion: 2,
    },
    get_available_staff: {
        roles: ["nurse", "physician"],
        shift: "evening",
        limit: 5,
    },
    update_supply_inventory: {
        supplyId: "SUP-004",
        quantityDelta: -2,
        reason: "Confirmed use for bed assignment workflow.",
        updatedByStaffId: "S-001",
        idempotencyKey: "inventory-update-001",
    },
    log_arize_trace: {
        traceId: "trace-001",
        operation: "triage_reasoning",
        agent: "triage",
        status: "ok",
        startedAt: "2026-06-07T20:15:00.000Z",
        endedAt: "2026-06-07T20:15:03.000Z",
        attributes: {
            workflow: "phase-2-contract-test",
        },
    },
} as const;

const invalidMcpInputs = {
    get_available_beds: {
        bedType: "hallway",
        limit: 0,
    },
    assign_patient_to_bed: {
        patientId: "",
        bedId: "B-003",
    },
    get_available_staff: {
        roles: ["surgeon"],
        shift: "overnight",
    },
    update_supply_inventory: {
        supplyId: "SUP-004",
        quantityDelta: 1.5,
        reason: "",
        updatedByStaffId: "S-001",
        idempotencyKey: "inventory-update-001",
    },
    log_arize_trace: {
        traceId: "trace-001",
        operation: "triage_reasoning",
        agent: "triage",
        status: "maybe",
        startedAt: "not-a-date",
    },
} as const;

test("all five MCP tool schemas exist and parse valid inputs", () => {
    assert.deepEqual(Object.keys(mcpToolSchemas).sort(), [...mcpToolNames].sort());

    for (const toolName of mcpToolNames) {
        const result = mcpToolSchemas[toolName].safeParse(
            validMcpInputs[toolName],
        );

        assert.equal(result.success, true, `${toolName} should parse`);
    }
});

test("invalid MCP tool inputs fail validation", () => {
    for (const toolName of mcpToolNames) {
        const result = mcpToolSchemas[toolName].safeParse(
            invalidMcpInputs[toolName],
        );

        assert.equal(result.success, false, `${toolName} should fail`);
    }
});

test("each sub-agent definition has the required contract fields", () => {
    assert.equal(subAgentDefinitions.length, 4);

    for (const definition of subAgentDefinitions) {
        assert.ok(definition.name);
        assert.ok(definition.responsibilities.length > 0);
        assert.ok(definition.inputs.length > 0);
        assert.ok(definition.outputs.length > 0);
        assert.ok(definition.allowedMcpTools.length > 0);
        assert.ok(definition.safetyConstraints.length > 0);
        assert.match(
            definition.safetyConstraints.join(" "),
            /operational recommendations only/i,
        );

        for (const toolName of definition.allowedMcpTools) {
            assert.ok(
                approvedMcpToolNames.includes(toolName),
                `${definition.name} allows unknown tool ${toolName}`,
            );
        }
    }
});

test("orchestrator routing rules cover required categories and fallback", () => {
    const categories = orchestratorRoutingRules.map((rule) => rule.category);

    assert.ok(categories.includes("triage"));
    assert.ok(categories.includes("bed/resource management"));
    assert.ok(categories.includes("staff coordination"));
    assert.ok(categories.includes("reporting/analytics"));
    assert.ok(categories.includes("unknown/unsupported request fallback"));

    const fallbackRule = orchestratorRoutingRules.find((rule) =>
        rule.category.includes("fallback"),
    );
    assert.equal(fallbackRule?.targetAgent, "orchestrator");
    assert.ok("fallback" in (fallbackRule ?? {}));
});

test("agent definition registry includes orchestrator and four sub-agents", () => {
    assert.deepEqual(
        agentDefinitions.map((definition) => definition.name).sort(),
        [
            "bed_resource_management",
            "orchestrator",
            "reporting_analytics",
            "staff_coordination",
            "triage",
        ],
    );
});

test("README links to architecture, MCP tools, and agents docs", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");

    assert.match(readme, /\[docs\/architecture\.md\]\(docs\/architecture\.md\)/);
    assert.match(readme, /\[docs\/mcp-tools\.md\]\(docs\/mcp-tools\.md\)/);
    assert.match(readme, /\[docs\/agents\.md\]\(docs\/agents\.md\)/);
});
