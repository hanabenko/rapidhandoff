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
import { criticalPatientMockData } from "./fixtures/critical-patient.js";

type Bed = (typeof criticalPatientMockData.beds)[number];
type Staff = (typeof criticalPatientMockData.staff)[number];
interface Supply {
    supplyId: string;
    name: string;
    quantity: number;
    reorderLevel: number;
}

export interface DemoMcpAuditEntry {
    tool: string;
    input: Record<string, unknown>;
}

export class MockMongoMcp {
    readonly auditLog: DemoMcpAuditEntry[] = [];
    private readonly beds = criticalPatientMockData.beds.map((bed) => ({
        ...bed,
    }));
    private readonly staff = criticalPatientMockData.staff.map((member) => ({
        ...member,
    }));
    private readonly supplies: Supply[] = criticalPatientMockData.supplies.map(
        (supply) => ({ ...supply }),
    );

    getHistoricalCases() {
        this.auditLog.push({
            tool: "find",
            input: {
                collection: "historical_cases",
                filter: { operationalPattern: "critical_arrival" },
            },
        });
        return criticalPatientMockData.historicalCases;
    }

    getDashboardData() {
        this.auditLog.push({
            tool: "aggregate",
            input: {
                collections: ["patients", "beds", "staff", "supplies", "events"],
            },
        });
        return criticalPatientMockData.dashboard;
    }

    getAvailableBeds(input: GetAvailableBedsInput): Bed[] {
        const parsed = getAvailableBedsInputSchema.parse(input);
        this.record("get_available_beds", parsed);

        return this.beds
            .filter(
                (bed) =>
                    bed.status === "available" &&
                    !bed.needsCleaning &&
                    (!parsed.bedType || bed.type === parsed.bedType) &&
                    (!parsed.requiresMonitor || bed.hasMonitor),
            )
            .slice(0, parsed.limit);
    }

    assignPatientToBed(input: AssignPatientToBedInput) {
        const parsed = assignPatientToBedInputSchema.parse(input);
        this.record("assign_patient_to_bed", parsed);

        const bed = this.beds.find((candidate) => candidate.bedId === parsed.bedId);
        if (!bed || bed.status !== "available" || bed.needsCleaning) {
            throw new Error(`Bed ${parsed.bedId} is not assignable.`);
        }
        if (
            parsed.expectedBedVersion !== undefined &&
            parsed.expectedBedVersion !== bed.version
        ) {
            throw new Error(`Bed ${parsed.bedId} version conflict.`);
        }

        Object.assign(bed, {
            status: "occupied",
            version: bed.version + 1,
        });

        return {
            status: "assigned" as const,
            patientId: parsed.patientId,
            bedId: parsed.bedId,
            eventId: "EVT-DEMO-BED-001",
        };
    }

    getAvailableStaff(input: GetAvailableStaffInput): Staff[] {
        const parsed = getAvailableStaffInputSchema.parse(input);
        this.record("get_available_staff", parsed);

        return this.staff
            .filter(
                (member) =>
                    member.available &&
                    (!parsed.shift || member.shift === parsed.shift) &&
                    (!parsed.roles || parsed.roles.includes(member.role)),
            )
            .slice(0, parsed.limit);
    }

    updateSupplyInventory(input: UpdateSupplyInventoryInput) {
        const parsed = updateSupplyInventoryInputSchema.parse(input);
        this.record("update_supply_inventory", parsed);

        const supply = this.supplies.find(
            (candidate) => candidate.supplyId === parsed.supplyId,
        );
        if (!supply) {
            throw new Error(`Supply ${parsed.supplyId} was not found.`);
        }

        const previousQuantity = supply.quantity;
        const newQuantity = previousQuantity + parsed.quantityDelta;
        if (newQuantity < 0) {
            throw new Error(`Supply ${parsed.supplyId} cannot fall below zero.`);
        }

        supply.quantity = newQuantity;
        return {
            status: "updated" as const,
            supplyId: parsed.supplyId,
            previousQuantity,
            newQuantity,
            eventId: "EVT-DEMO-SUPPLY-001",
        };
    }

    getSupply(name: string): Supply | undefined {
        return this.supplies.find((supply) => supply.name === name);
    }

    private record(tool: string, input: Record<string, unknown>): void {
        this.auditLog.push({ tool, input });
    }
}

export class MockPhoenixMcp {
    readonly auditLog: DemoMcpAuditEntry[] = [];

    logTrace(input: LogArizeTraceInput) {
        const parsed = logArizeTraceInputSchema.parse(input);
        this.auditLog.push({
            tool: "log_arize_trace",
            input: parsed,
        });

        return {
            status: "logged" as const,
            traceId: parsed.traceId,
            eventId: "TRACE-DEMO-CRITICAL-001",
            project: "rapid-handoff-er-demo",
        };
    }
}
