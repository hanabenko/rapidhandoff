import { orchestratorRoutingRules } from "../agents/definitions.js";
import {
    criticalPatientDemoInput,
    criticalPatientMockData,
} from "./fixtures/critical-patient.js";
import {
    createLiveTracePort,
    LiveMongoDemoMcp,
    type DemoMongoMcpPort,
    type DemoTracePort,
} from "./live-mcp.js";
import {
    runCriticalPatientDemo,
    type CriticalPatientDemoOutput,
} from "./critical-patient-workflow.js";

export interface LiveDemoFailure {
    scenario: string;
    mode: "live";
    status: "configuration_error" | "needs_escalation";
    stage: "configuration" | "bed_resource_management" | "staff_coordination";
    message: string;
    traceEventId?: string;
    mcpCalls: string[];
    safetyNote: string;
}

export type CriticalPatientRuntimeResult =
    | CriticalPatientDemoOutput
    | LiveDemoFailure;

export interface CriticalPatientRuntimeOptions {
    env?: NodeJS.ProcessEnv;
    mongoMcp?: DemoMongoMcpPort;
    traceMcp?: DemoTracePort;
}

function isLiveMode(env: NodeJS.ProcessEnv): boolean {
    return env.LIVE_MCP?.toLowerCase() === "true";
}

function routeAgents(): string[] {
    return orchestratorRoutingRules
        .filter((rule) =>
            [
                "triage",
                "bed/resource management",
                "staff coordination",
                "reporting/analytics",
            ].includes(rule.category),
        )
        .map((rule) => rule.targetAgent);
}

function mcpCalls(
    mongoMcp: DemoMongoMcpPort,
    traceMcp: DemoTracePort,
): string[] {
    return [
        ...mongoMcp.auditLog.map((entry) => entry.tool),
        ...traceMcp.auditLog.map((entry) => entry.tool),
    ];
}

async function logFallback(
    traceMcp: DemoTracePort,
    stage: LiveDemoFailure["stage"],
    message: string,
): Promise<string | undefined> {
    try {
        return (
            await traceMcp.logTrace({
                traceId: `trace-live-critical-${stage}`,
                operation: "critical_patient_live_fallback",
                agent: "orchestrator",
                status: "error",
                startedAt: criticalPatientDemoInput.patient.arrivalContext.arrivalTime,
                endedAt: "2026-06-07T20:00:05.000Z",
                attributes: { stage },
                input: { scenario: criticalPatientDemoInput.scenario },
                errorMessage: message,
            })
        ).eventId;
    } catch {
        return undefined;
    }
}

async function runLiveWorkflow(
    mongoMcp: DemoMongoMcpPort,
    traceMcp: DemoTracePort,
): Promise<CriticalPatientRuntimeResult> {
    const input = criticalPatientDemoInput;
    const route = routeAgents();

    try {
        const historicalCases = await mongoMcp.getHistoricalCases();
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

        const [bed] = await mongoMcp.getAvailableBeds({
            bedType: "trauma",
            requiresMonitor: true,
            limit: 1,
        });
        if (!bed) {
            const message =
                "No clean monitored trauma bed is available. Escalate to charge leadership and activate overflow/transfer procedures.";
            const traceEventId = await logFallback(
                traceMcp,
                "bed_resource_management",
                message,
            );
            return {
                scenario: input.scenario,
                mode: "live",
                status: "needs_escalation",
                stage: "bed_resource_management",
                message,
                traceEventId,
                mcpCalls: mcpCalls(mongoMcp, traceMcp),
                safetyNote:
                    "Operational recommendation only; licensed clinical staff must confirm acuity, diagnosis, and treatment.",
            };
        }

        const availableStaff = await mongoMcp.getAvailableStaff({
            roles: ["nurse", "physician"],
            shift: input.patient.arrivalContext.currentShift,
            limit: 10,
        });
        const nurse = availableStaff.find((member) => member.role === "nurse");
        const doctor = availableStaff.find(
            (member) => member.role === "physician",
        );
        if (!nurse || !doctor) {
            const message =
                "Required nurse and physician coverage is unavailable. Hold the bed recommendation and escalate to charge leadership.";
            const traceEventId = await logFallback(
                traceMcp,
                "staff_coordination",
                message,
            );
            return {
                scenario: input.scenario,
                mode: "live",
                status: "needs_escalation",
                stage: "staff_coordination",
                message,
                traceEventId,
                mcpCalls: mcpCalls(mongoMcp, traceMcp),
                safetyNote:
                    "Operational recommendation only; licensed clinical staff must confirm acuity, diagnosis, and treatment.",
            };
        }

        await mongoMcp.assignPatientToBed({
            patientId: input.patient.patientId,
            bedId: bed.bedId,
            assignedByStaffId: nurse.staffId,
            expectedBedVersion: bed.version,
        });

        const supplyChecklist = [
            "Oxygen cannulas",
            "ECG electrodes",
            "IV start kits",
        ];
        const oxygenSupply = await mongoMcp.getSupply("Oxygen cannulas");
        if (oxygenSupply) {
            await mongoMcp.updateSupplyInventory({
                supplyId: oxygenSupply.supplyId,
                quantityDelta: -1,
                reason: "Reserved for live critical-patient demo workflow.",
                updatedByStaffId: nurse.staffId,
                idempotencyKey: `live-critical-${input.patient.patientId}-oxygen`,
            });
        }

        const dashboard = await mongoMcp.getDashboardData();
        const totalBeds =
            dashboard.totalBeds || criticalPatientMockData.dashboard.totalBeds;
        const occupiedBedsAfterAssignment =
            dashboard.occupiedBedsBeforeAssignment + 1;
        const availableStaffAfterAssignment = Math.max(
            dashboard.availableStaffBeforeAssignment - 2,
            0,
        );
        const scheduledStaff =
            dashboard.scheduledStaff ||
            criticalPatientMockData.dashboard.scheduledStaff;
        const bedOccupancyRate = Number(
            (occupiedBedsAfterAssignment / totalBeds).toFixed(2),
        );
        const staffUtilization = Number(
            (
                (scheduledStaff - availableStaffAfterAssignment) /
                scheduledStaff
            ).toFixed(2),
        );
        const dashboardSummary = {
            averageWaitTimeMinutes:
                dashboard.averageWaitTimeMinutesBeforeArrival,
            bedOccupancyRate,
            staffUtilization,
            criticalAlerts: [
                `New ESI-1 operational priority assigned to ${bed.room}.`,
                ...(bedOccupancyRate >= 0.85
                    ? ["Bed occupancy is above 85%."]
                    : []),
            ],
            narrative:
                "Critical patient placed; monitored trauma capacity and assigned staff utilization were recalculated from live MCP data.",
        };

        let traceEventId = "TRACE-LIVE-NOT-CONFIGURED";
        try {
            traceEventId = (
                await traceMcp.logTrace({
                    traceId: "trace-live-critical-001",
                    operation: "critical_patient_live_workflow",
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
                })
            ).eventId;
        } catch (error) {
            traceEventId = `TRACE-LOGGING-FAILED:${
                error instanceof Error ? error.message : String(error)
            }`;
        }

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
                alertMessage: `CRITICAL ARRIVAL: ESI-1 operational priority assigned to ${bed.room}. ${nurse.name} and ${doctor.name} requested for immediate response.`,
            },
            dashboardSummary,
            traceEventId,
            mcpCalls: mcpCalls(mongoMcp, traceMcp),
            safetyNote:
                "Operational recommendation only; licensed clinical staff must confirm acuity, diagnosis, and treatment.",
        };
    } finally {
        await Promise.allSettled([mongoMcp.close?.(), traceMcp.close?.()]);
    }
}

export async function runCriticalPatientRuntime(
    options: CriticalPatientRuntimeOptions = {},
): Promise<CriticalPatientRuntimeResult> {
    const env = options.env ?? process.env;
    if (!isLiveMode(env)) {
        return runCriticalPatientDemo();
    }

    try {
        const mongoMcp = options.mongoMcp ?? new LiveMongoDemoMcp(env);
        const traceMcp = options.traceMcp ?? createLiveTracePort(env);
        return await runLiveWorkflow(mongoMcp, traceMcp);
    } catch (error) {
        return {
            scenario: criticalPatientDemoInput.scenario,
            mode: "live",
            status: "configuration_error",
            stage: "configuration",
            message:
                error instanceof Error
                    ? error.message
                    : "Live MCP integration could not be initialized.",
            mcpCalls: [],
            safetyNote:
                "No further live action was attempted after the integration error.",
        };
    }
}
