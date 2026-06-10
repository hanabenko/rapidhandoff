import assert from "node:assert/strict";
import test from "node:test";

import { runCriticalPatientDemo } from "./critical-patient-workflow.js";
import { MockMongoMcp, MockPhoenixMcp } from "./mock-mcp.js";
import {
    type DemoBed,
    type DemoDashboardData,
    type DemoMongoMcpPort,
    type DemoStaff,
    type DemoSupply,
    type DemoTracePort,
} from "./live-mcp.js";
import { runCriticalPatientRuntime } from "./runtime.js";
import { criticalPatientMockData } from "./fixtures/critical-patient.js";
import {
    assignPatientToBedInputSchema,
    getAvailableBedsInputSchema,
    getAvailableStaffInputSchema,
    logArizeTraceInputSchema,
    updateSupplyInventoryInputSchema,
    type AssignPatientToBedInput,
    type GetAvailableBedsInput,
    type GetAvailableStaffInput,
    type LogArizeTraceInput,
    type UpdateSupplyInventoryInput,
} from "../mcp/schemas.js";

test("critical patient demo completes the full deterministic workflow", () => {
    const mongoMcp = new MockMongoMcp();
    const phoenixMcp = new MockPhoenixMcp();
    const result = runCriticalPatientDemo({ mongoMcp, phoenixMcp });

    assert.deepEqual(result.route, [
        "triage",
        "bed_resource_management",
        "staff_coordination",
        "reporting_analytics",
    ]);
    assert.equal(result.triage.esiLevel, 1);
    assert.equal(result.triage.carePathway, "resuscitation_critical");
    assert.equal(result.resources.assignedBed.bedId, "B-TRAUMA-01");
    assert.equal(result.resources.assignedBed.room, "TRAUMA-1");
    assert.equal(result.resources.estimatedWaitTimeMinutes, 0);
    assert.equal(result.staffing.assignedNurse.staffId, "S-NURSE-01");
    assert.equal(result.staffing.assignedDoctor.staffId, "S-PHYS-01");
    assert.match(result.staffing.alertMessage, /CRITICAL ARRIVAL/);
    assert.equal(result.dashboardSummary.averageWaitTimeMinutes, 42);
    assert.equal(result.dashboardSummary.bedOccupancyRate, 0.89);
    assert.equal(result.dashboardSummary.staffUtilization, 0.71);
    assert.equal(result.traceEventId, "TRACE-DEMO-CRITICAL-001");

    for (const toolName of [
        "get_available_beds",
        "assign_patient_to_bed",
        "get_available_staff",
        "update_supply_inventory",
        "log_arize_trace",
    ]) {
        assert.ok(result.mcpCalls.includes(toolName), `${toolName} was not called`);
    }

    assert.equal(mongoMcp.getSupply("Oxygen cannulas")?.quantity, 23);
    assert.equal(phoenixMcp.auditLog.length, 1);
    assert.match(result.safetyNote, /Operational recommendation only/);
});

class StubLiveMongoMcp implements DemoMongoMcpPort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];
    private readonly beds: DemoBed[];
    private readonly staff: DemoStaff[];
    private readonly supplies: DemoSupply[];

    constructor(options: { beds?: DemoBed[]; staff?: DemoStaff[] } = {}) {
        this.beds =
            options.beds ??
            criticalPatientMockData.beds.map((bed) => ({
                bedId: bed.bedId,
                room: bed.room,
                type: bed.type,
                status: bed.status,
                needsCleaning: bed.needsCleaning,
                hasMonitor: bed.hasMonitor,
                version: bed.version,
            }));
        this.staff =
            options.staff ??
            criticalPatientMockData.staff.map((member) => ({
                staffId: member.staffId,
                name: member.name,
                role: member.role,
                shift: member.shift,
                available: member.available,
            }));
        this.supplies = criticalPatientMockData.supplies.map((supply) => ({
            supplyId: supply.supplyId,
            name: supply.name,
            quantity: supply.quantity,
            reorderLevel: supply.reorderLevel,
        }));
    }

    async getHistoricalCases(): Promise<Array<Record<string, unknown>>> {
        this.auditLog.push({
            tool: "find",
            input: { collection: "historical_cases" },
        });
        return [...criticalPatientMockData.historicalCases];
    }

    async getDashboardData(): Promise<DemoDashboardData> {
        this.auditLog.push({
            tool: "aggregate",
            input: { collection: "dashboard" },
        });
        return criticalPatientMockData.dashboard;
    }

    async getAvailableBeds(input: GetAvailableBedsInput): Promise<DemoBed[]> {
        const parsed = getAvailableBedsInputSchema.parse(input);
        this.auditLog.push({ tool: "get_available_beds", input: parsed });
        return this.beds.filter(
            (bed) =>
                bed.status === "available" &&
                !bed.needsCleaning &&
                (!parsed.bedType || bed.type === parsed.bedType) &&
                (!parsed.requiresMonitor || bed.hasMonitor),
        );
    }

    async assignPatientToBed(input: AssignPatientToBedInput): Promise<unknown> {
        const parsed = assignPatientToBedInputSchema.parse(input);
        this.auditLog.push({ tool: "assign_patient_to_bed", input: parsed });
        return { status: "assigned", eventId: "EVT-STUB-BED-001" };
    }

    async getAvailableStaff(input: GetAvailableStaffInput): Promise<DemoStaff[]> {
        const parsed = getAvailableStaffInputSchema.parse(input);
        this.auditLog.push({ tool: "get_available_staff", input: parsed });
        return this.staff.filter(
            (member) =>
                member.available &&
                (!parsed.shift || member.shift === parsed.shift) &&
                (!parsed.roles || parsed.roles.includes(member.role)),
        );
    }

    async getSupply(name: string): Promise<DemoSupply | undefined> {
        this.auditLog.push({ tool: "find", input: { collection: "supplies", name } });
        return this.supplies.find((supply) => supply.name === name);
    }

    async updateSupplyInventory(
        input: UpdateSupplyInventoryInput,
    ): Promise<unknown> {
        const parsed = updateSupplyInventoryInputSchema.parse(input);
        this.auditLog.push({ tool: "update_supply_inventory", input: parsed });
        return { status: "updated", eventId: "EVT-STUB-SUPPLY-001" };
    }
}

class StubTraceMcp implements DemoTracePort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];

    async logTrace(input: LogArizeTraceInput) {
        const parsed = logArizeTraceInputSchema.parse(input);
        this.auditLog.push({ tool: "log_arize_trace", input: parsed });
        return { status: "logged", eventId: "TRACE-STUB-001" };
    }
}

test("runtime defaults to mock mode without credentials", async () => {
    const result = await runCriticalPatientRuntime({ env: {} });

    assert.ok(!("status" in result));
    assert.equal(result.triage.esiLevel, 1);
    assert.equal(result.traceEventId, "TRACE-DEMO-CRITICAL-001");
});

test("local live mode fails gracefully when MongoDB URI is missing", async () => {
    const result = await runCriticalPatientRuntime({
        env: { LIVE_MCP: "true" },
    });

    assert.ok("status" in result);
    assert.equal(result.status, "configuration_error");
    assert.match(result.message, /MONGODB_URI/);
    assert.deepEqual(result.mcpCalls, []);
});

test("live mode returns escalation fallback when no beds are available", async () => {
    const result = await runCriticalPatientRuntime({
        env: { LIVE_MCP: "true" },
        mongoMcp: new StubLiveMongoMcp({ beds: [] }),
        traceMcp: new StubTraceMcp(),
    });

    assert.ok("status" in result);
    assert.equal(result.status, "needs_escalation");
    assert.equal(result.stage, "bed_resource_management");
    assert.match(result.message, /No clean monitored trauma bed/);
    assert.ok(result.mcpCalls.includes("get_available_beds"));
    assert.ok(!result.mcpCalls.includes("assign_patient_to_bed"));
    assert.equal(result.traceEventId, "TRACE-STUB-001");
});

test("live mode returns escalation fallback when no staff are available", async () => {
    const result = await runCriticalPatientRuntime({
        env: { LIVE_MCP: "true" },
        mongoMcp: new StubLiveMongoMcp({ staff: [] }),
        traceMcp: new StubTraceMcp(),
    });

    assert.ok("status" in result);
    assert.equal(result.status, "needs_escalation");
    assert.equal(result.stage, "staff_coordination");
    assert.match(result.message, /Required nurse and physician coverage/);
    assert.ok(result.mcpCalls.includes("get_available_beds"));
    assert.ok(result.mcpCalls.includes("get_available_staff"));
    assert.ok(!result.mcpCalls.includes("assign_patient_to_bed"));
    assert.equal(result.traceEventId, "TRACE-STUB-001");
});
