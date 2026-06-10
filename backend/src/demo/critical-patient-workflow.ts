import { orchestratorRoutingRules } from "../agents/definitions.js";
import {
    criticalPatientDemoInput,
    criticalPatientMockData,
} from "./fixtures/critical-patient.js";
import { MockMongoMcp, MockPhoenixMcp } from "./mock-mcp.js";

export interface CriticalPatientDemoOutput {
    scenario: string;
    route: string[];
    triage: {
        esiLevel: 1 | 2 | 3 | 4 | 5;
        carePathway: string;
        reasoning: string[];
        recommendedNextAction: string;
    };
    resources: {
        assignedBed: {
            bedId: string;
            room: string;
            type: string;
        };
        estimatedWaitTimeMinutes: number;
        supplyChecklist: string[];
    };
    staffing: {
        assignedNurse: {
            staffId: string;
            name: string;
        };
        assignedDoctor: {
            staffId: string;
            name: string;
        };
        alertMessage: string;
    };
    dashboardSummary: {
        averageWaitTimeMinutes: number;
        bedOccupancyRate: number;
        staffUtilization: number;
        criticalAlerts: string[];
        narrative: string;
    };
    traceEventId: string;
    mcpCalls: string[];
    safetyNote: string;
}

export interface CriticalPatientDemoDependencies {
    mongoMcp?: MockMongoMcp;
    phoenixMcp?: MockPhoenixMcp;
}

export function runCriticalPatientDemo(
    dependencies: CriticalPatientDemoDependencies = {},
): CriticalPatientDemoOutput {
    const mongoMcp = dependencies.mongoMcp ?? new MockMongoMcp();
    const phoenixMcp = dependencies.phoenixMcp ?? new MockPhoenixMcp();
    const input = criticalPatientDemoInput;

    const route = orchestratorRoutingRules
        .filter((rule) =>
            [
                "triage",
                "bed/resource management",
                "staff coordination",
                "reporting/analytics",
            ].includes(rule.category),
        )
        .map((rule) => rule.targetAgent);

    const historicalCases = mongoMcp.getHistoricalCases();
    const triage = {
        esiLevel: 1 as const,
        carePathway: "resuscitation_critical",
        reasoning: [
            "Severe hypotension, hypoxia, tachycardia, and altered responsiveness indicate immediate operational priority.",
            `${historicalCases.length} matching critical operational patterns support immediate monitored trauma placement.`,
        ],
        recommendedNextAction:
            "Activate immediate critical-patient rooming and multidisciplinary staff response.",
    };

    const [bed] = mongoMcp.getAvailableBeds({
        bedType: "trauma",
        requiresMonitor: true,
        limit: 1,
    });
    if (!bed) {
        throw new Error("The deterministic demo expected an available trauma bed.");
    }

    mongoMcp.assignPatientToBed({
        patientId: input.patient.patientId,
        bedId: bed.bedId,
        assignedByStaffId: "S-NURSE-01",
        expectedBedVersion: bed.version,
    });

    const availableStaff = mongoMcp.getAvailableStaff({
        roles: ["nurse", "physician"],
        shift: input.patient.arrivalContext.currentShift,
        limit: 10,
    });
    const nurse = availableStaff.find((member) => member.role === "nurse");
    const doctor = availableStaff.find((member) => member.role === "physician");
    if (!nurse || !doctor) {
        throw new Error("The deterministic demo expected nurse and physician coverage.");
    }

    const supplyChecklist = [
        "Oxygen cannulas",
        "ECG electrodes",
        "IV start kits",
    ];
    const oxygenSupply = mongoMcp.getSupply("Oxygen cannulas");
    if (!oxygenSupply) {
        throw new Error("The deterministic demo expected oxygen supplies.");
    }
    mongoMcp.updateSupplyInventory({
        supplyId: oxygenSupply.supplyId,
        quantityDelta: -1,
        reason: "Reserved for deterministic critical-patient demo workflow.",
        updatedByStaffId: nurse.staffId,
        idempotencyKey: "demo-critical-patient-oxygen-001",
    });

    const dashboard = mongoMcp.getDashboardData();
    const occupiedBedsAfterAssignment = dashboard.occupiedBedsBeforeAssignment + 1;
    const availableStaffAfterAssignment =
        dashboard.availableStaffBeforeAssignment - 2;
    const bedOccupancyRate = Number(
        (occupiedBedsAfterAssignment / dashboard.totalBeds).toFixed(2),
    );
    const staffUtilization = Number(
        (
            (dashboard.scheduledStaff - availableStaffAfterAssignment) /
            dashboard.scheduledStaff
        ).toFixed(2),
    );
    const dashboardSummary = {
        averageWaitTimeMinutes: dashboard.averageWaitTimeMinutesBeforeArrival,
        bedOccupancyRate,
        staffUtilization,
        criticalAlerts: [
            "New ESI-1 operational priority assigned to TRAUMA-1.",
            "Bed occupancy is above 85%.",
        ],
        narrative:
            "Critical patient placed immediately; monitored trauma capacity is now constrained and assigned staff utilization increased.",
    };

    const trace = phoenixMcp.logTrace({
        traceId: "trace-demo-critical-001",
        operation: "critical_patient_end_to_end_demo",
        agent: "orchestrator",
        status: "ok",
        startedAt: input.patient.arrivalContext.arrivalTime,
        endedAt: "2026-06-07T20:00:05.000Z",
        attributes: {
            route,
            esiLevel: triage.esiLevel,
            carePathway: triage.carePathway,
            assignedBedId: bed.bedId,
        },
        input: {
            scenario: input.scenario,
            patientId: input.patient.patientId,
        },
        output: {
            assignedBedId: bed.bedId,
            assignedNurseId: nurse.staffId,
            assignedDoctorId: doctor.staffId,
        },
    });

    return {
        scenario: input.scenario,
        route,
        triage,
        resources: {
            assignedBed: {
                bedId: bed.bedId,
                room: bed.room,
                type: bed.type,
            },
            estimatedWaitTimeMinutes: 0,
            supplyChecklist,
        },
        staffing: {
            assignedNurse: {
                staffId: nurse.staffId,
                name: nurse.name,
            },
            assignedDoctor: {
                staffId: doctor.staffId,
                name: doctor.name,
            },
            alertMessage:
                "CRITICAL ARRIVAL: ESI-1 operational priority assigned to TRAUMA-1. Rachel Green and Dr. Elena Morris requested for immediate response.",
        },
        dashboardSummary,
        traceEventId: trace.eventId,
        mcpCalls: [
            ...mongoMcp.auditLog.map((entry) => entry.tool),
            ...phoenixMcp.auditLog.map((entry) => entry.tool),
        ],
        safetyNote:
            "Operational recommendation only; licensed clinical staff must confirm acuity, diagnosis, and treatment.",
    };
}
