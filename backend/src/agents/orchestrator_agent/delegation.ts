import {
    InMemoryRunner,
    isFinalResponse,
    stringifyContent,
    type Event,
    type LlmAgent,
} from "@google/adk";

import {
    buildBedCapacityAnalysis,
    buildCensusSummary,
    buildStaffingRecommendation,
} from "./analytics.js";
import {
    rootSynthesisAgent,
} from "./agent.js";
import {
    rootOrchestratorAgentInputSchema,
    workflowContextSchema,
    type RootOrchestratorAgentInput,
    type RootOrchestratorAgentOutput,
    type WorkflowContext,
} from "./contracts.js";
import {
    bedManagementAgentInputSchema,
    bedCandidateSchema,
    type BedManagementAgentInput,
    type BedManagementAgentOutput,
} from "../bed_management_agent/contracts.js";
import { bedManagementAgent } from "../bed_management_agent/agent.js";
import {
    reportingAgentInputSchema,
    type ReportingAgentInput,
    type ReportingAgentOutput,
} from "../reporting_agent/contracts.js";
import { reportingAgent } from "../reporting_agent/agent.js";
import {
    staffCoordinationAgentInputSchema,
    type StaffCoordinationAgentInput,
    type StaffCoordinationAgentOutput,
} from "../staff_coordination_agent/contracts.js";
import { staffCoordinationAgent } from "../staff_coordination_agent/agent.js";
import {
    triageAgentInputSchema,
    type TriageAgentInput,
    type TriageAgentOutput,
} from "../triage_agent/contracts.js";
import { triageAgent } from "../triage_agent/agent.js";
import { getMongoErRepository, type MongoErRepository } from "./data.js";
import {
    buildBedAssignmentTraceAttributes,
    buildDelegationCompletionAttributes,
    buildDelegationOutputAttributes,
    buildDelegationStartAttributes,
    buildStaffAssignmentTraceAttributes,
    buildWorkflowContextAttributes,
    withWorkflowSpan,
    workflowSpanNames,
} from "../../observability/tracing.js";

export interface DelegationLog {
    agent: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
}

export interface DelegatedWorkflowResult {
    response: string;
    workflow: {
        triage: TriageAgentOutput;
        bedAssignment: BedManagementAgentOutput;
        staffAssignment: StaffCoordinationAgentOutput;
        reporting: ReportingAgentOutput;
    };
    delegations: DelegationLog[];
    toolCalls: Array<{
        name?: string;
        args?: Record<string, unknown>;
    }>;
    toolResponses: Array<{
        name?: string;
        response?: unknown;
    }>;
}

type StructuredAgentMap = {
    triage: {
        agent: LlmAgent;
        inputSchema: typeof triageAgentInputSchema;
    };
    bed: {
        agent: LlmAgent;
        inputSchema: typeof bedManagementAgentInputSchema;
    };
    staff: {
        agent: LlmAgent;
        inputSchema: typeof staffCoordinationAgentInputSchema;
    };
    reporting: {
        agent: LlmAgent;
        inputSchema: typeof reportingAgentInputSchema;
    };
    root: {
        agent: LlmAgent;
        inputSchema: typeof rootOrchestratorAgentInputSchema;
    };
};

export interface MultiAgentDependencies {
    repository?: MongoErRepository;
    agents?: Partial<StructuredAgentMap>;
}

interface StructuredAgentRunResult<TOutput> {
    output: TOutput;
    responseText: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function parseContext(input: {
    context?: string | Record<string, unknown>;
    query: string;
}): WorkflowContext | undefined {
    const raw =
        typeof input.context === "string"
            ? (() => {
                  try {
                      return JSON.parse(input.context) as unknown;
                  } catch {
                      return undefined;
                  }
              })()
            : input.context;
    const parsed = workflowContextSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    return undefined;
}

export function canUseDelegatedWorkflow(input: {
    query: string;
    context?: string | Record<string, unknown>;
}): boolean {
    const workflowContext = parseContext(input);
    if (workflowContext) {
        return true;
    }

    const query = input.query.toLowerCase();
    return (
        query.includes("patient") &&
        (query.includes("bed") ||
            query.includes("staff") ||
            query.includes("triage") ||
            query.includes("assign"))
    );
}

async function runStructuredAgent<TInput, TOutput>(
    agent: LlmAgent,
    userId: string,
    input: TInput,
): Promise<StructuredAgentRunResult<TOutput>> {
    const runner = new InMemoryRunner({
        agent,
        appName: `rapid_handoff_${agent.name}`,
    });

    let responseText = "";
    let agentError: { code?: string; message?: string } | undefined;
    for await (const event of runner.runEphemeral({
        userId,
        newMessage: {
            role: "user",
            parts: [{ text: JSON.stringify(input) }],
        },
    })) {
        const adkEvent = event as Event;
        if (adkEvent.errorCode || adkEvent.errorMessage) {
            agentError = {
                code: adkEvent.errorCode,
                message: adkEvent.errorMessage,
            };
        }

        const text = stringifyContent(adkEvent);
        if (text && (isFinalResponse(adkEvent) || !responseText)) {
            responseText = text;
        }
    }

    if (agentError) {
        const detail =
            agentError.message ??
            agentError.code ??
            "The model request failed without an error message.";
        throw new Error(`${agent.name} model request failed: ${detail}`);
    }

    if (!responseText) {
        throw new Error(`${agent.name} completed without a structured response.`);
    }

    let output: TOutput;
    try {
        output = JSON.parse(responseText) as TOutput;
    } catch {
        throw new Error(
            `${agent.name} returned an invalid structured response.`,
        );
    }

    return {
        output,
        responseText,
    };
}

async function runDelegation<TInput extends Record<string, unknown>, TOutput>(
    name: string,
    agent: LlmAgent,
    userId: string,
    input: TInput,
): Promise<{ output: TOutput; log: DelegationLog }> {
    await withWorkflowSpan(
        workflowSpanNames.delegationStart,
        buildDelegationStartAttributes(name, input),
        async () => undefined,
    );

    const result = await runStructuredAgent<TInput, TOutput>(agent, userId, input);

    await withWorkflowSpan(
        workflowSpanNames.delegationOutput,
        buildDelegationOutputAttributes(name, result.output),
        async () => undefined,
    );

    await withWorkflowSpan(
        workflowSpanNames.delegationCompletion,
        buildDelegationCompletionAttributes(name, result.output),
        async () => undefined,
    );

    return {
        output: result.output,
        log: {
            agent: agent.name,
            input,
            output: asObject(result.output) ?? { result: result.output },
        },
    };
}

function candidateBedType(
    routingPriority: TriageAgentOutput["routingPriority"],
    recommendedBedType: WorkflowContext["requestedBedType"] | TriageAgentOutput["recommendedBedType"],
): WorkflowContext["requestedBedType"] | TriageAgentOutput["recommendedBedType"] {
    if (routingPriority === "trauma_bay") {
        return "trauma";
    }
    return recommendedBedType;
}

function candidateRoles(
    severity: TriageAgentOutput["severity"],
): Array<"physician" | "nurse"> {
    if (severity === "critical" || severity === "high") {
        return ["physician", "nurse"];
    }
    return ["nurse"];
}

export async function runDelegatedErWorkflow(
    input: {
        query: string;
        context?: string | Record<string, unknown>;
        userId?: string;
    },
    dependencies: MultiAgentDependencies = {},
): Promise<DelegatedWorkflowResult> {
    const workflowContext = parseContext(input);
    if (!workflowContext) {
        throw new Error(
            "Delegated workflow requires structured context with at least patientId.",
        );
    }

    const repository = dependencies.repository ?? getMongoErRepository();
    const userId = input.userId ?? "cloud-run-api";
    const agents = {
        triage: dependencies.agents?.triage?.agent ?? triageAgent,
        bed: dependencies.agents?.bed?.agent ?? bedManagementAgent,
        staff: dependencies.agents?.staff?.agent ?? staffCoordinationAgent,
        reporting: dependencies.agents?.reporting?.agent ?? reportingAgent,
        root: dependencies.agents?.root?.agent ?? rootSynthesisAgent,
    };
    const delegations: DelegationLog[] = [];
    const toolCalls: DelegatedWorkflowResult["toolCalls"] = [];
    const toolResponses: DelegatedWorkflowResult["toolResponses"] = [];

    return withWorkflowSpan(
        workflowSpanNames.orchestrationWorkflow,
        buildWorkflowContextAttributes(workflowContext),
        async () => {
            const intakeResult = await repository.upsertPatientIntake({
                patientId: workflowContext.patientId,
                age: workflowContext.age,
                chiefComplaint: workflowContext.chiefComplaint,
                symptoms: workflowContext.symptoms,
                vitals: workflowContext.vitals,
                triageLevel: workflowContext.triageLevel,
                status: workflowContext.status,
                arrivalTime: workflowContext.arrivalTime,
            });
            toolCalls.push({
                name: "upsert_patient_intake",
                args: {
                    patientId: workflowContext.patientId,
                },
            });
            toolResponses.push({
                name: "upsert_patient_intake",
                response: intakeResult,
            });

            const triageInput: TriageAgentInput = {
                patientId: workflowContext.patientId,
                age: workflowContext.age,
                chiefComplaint: workflowContext.chiefComplaint,
                symptoms: workflowContext.symptoms ?? [],
                vitals: workflowContext.vitals,
                reportedTriageLevel: workflowContext.triageLevel,
                requestedBedType: workflowContext.requestedBedType,
                requiresMonitor: workflowContext.requiresMonitor,
            };
            const triage = await runDelegation<
                TriageAgentInput,
                TriageAgentOutput
            >("triage", agents.triage, userId, triageInput);
            delegations.push(triage.log);

            const availableBeds = await repository.getAvailableBeds({
                bedType: candidateBedType(
                    triage.output.routingPriority,
                    workflowContext.requestedBedType ??
                        triage.output.recommendedBedType,
                ),
                requiresMonitor:
                    workflowContext.requiresMonitor ??
                    triage.output.requiresMonitor,
                limit: 10,
            });
            toolCalls.push({
                name: "get_available_beds",
                args: {
                    bedType:
                        workflowContext.requestedBedType ??
                        triage.output.recommendedBedType,
                    requiresMonitor:
                        workflowContext.requiresMonitor ??
                        triage.output.requiresMonitor,
                    limit: 10,
                },
            });
            toolResponses.push({
                name: "get_available_beds",
                response: availableBeds,
            });

            const bedInput: BedManagementAgentInput = {
                patientId: workflowContext.patientId,
                severity: triage.output.severity,
                urgency: triage.output.urgency,
                routingPriority: triage.output.routingPriority,
                recommendedBedType:
                    workflowContext.requestedBedType ??
                    triage.output.recommendedBedType,
                requiresMonitor:
                    workflowContext.requiresMonitor ??
                    triage.output.requiresMonitor,
                candidateBeds: availableBeds.map((bed) =>
                    bedCandidateSchema.parse({
                        bedId: bed.bedId,
                        type: bed.type,
                        room: bed.room,
                        hasMonitor: bed.hasMonitor,
                        version: bed.version,
                    }),
                ),
            };
            const bed = await runDelegation<
                BedManagementAgentInput,
                BedManagementAgentOutput
            >("bed_management", agents.bed, userId, bedInput);

            if (availableBeds.length === 0) {
                bed.output = {
                    ...bed.output,
                    assignmentStatus: "waitlisted",
                    selectedBedId: null,
                    selectedBedType: bedInput.recommendedBedType,
                    estimatedWaitMinutes: Math.max(
                        bed.output.estimatedWaitMinutes,
                        15,
                    ),
                    rationale:
                        "No eligible bed is currently available. Patient remains queued for the next appropriate bed.",
                };
                bed.log.output = asObject(bed.output) ?? {};
            }
            delegations.push(bed.log);

            const selectedBed = availableBeds.find(
                (candidate) => candidate.bedId === bed.output.selectedBedId,
            );
            if (availableBeds.length > 0 && !selectedBed) {
                throw new Error(
                    `Bed agent selected unavailable bed ${bed.output.selectedBedId}.`,
                );
            }

            let staff: {
                output: StaffCoordinationAgentOutput;
                log: DelegationLog;
            };
            if (selectedBed && bed.output.selectedBedId) {
                const bedAssignmentInput = {
                    patientId: workflowContext.patientId,
                    bedId: bed.output.selectedBedId,
                    assignedByStaffId: workflowContext.assignedByStaffId,
                    expectedBedVersion: selectedBed.version,
                };
                const bedAssignmentResult = await withWorkflowSpan(
                    workflowSpanNames.bedAssignment,
                    buildBedAssignmentTraceAttributes(bedAssignmentInput),
                    async () =>
                        repository.assignPatientToBed(bedAssignmentInput),
                );
                toolCalls.push({
                    name: "assign_patient_to_bed",
                    args: bedAssignmentInput,
                });
                toolResponses.push({
                    name: "assign_patient_to_bed",
                    response: bedAssignmentResult,
                });

                const availableStaff = await repository.getAvailableStaff({
                    roles: candidateRoles(triage.output.severity),
                    shift: workflowContext.preferredShift,
                    limit: 10,
                });
                toolCalls.push({
                    name: "get_available_staff",
                    args: {
                        roles: candidateRoles(triage.output.severity),
                        shift: workflowContext.preferredShift,
                        limit: 10,
                    },
                });
                toolResponses.push({
                    name: "get_available_staff",
                    response: availableStaff,
                });

                const staffInput: StaffCoordinationAgentInput = {
                    patientId: workflowContext.patientId,
                    severity: triage.output.severity,
                    urgency: triage.output.urgency,
                    routingPriority: triage.output.routingPriority,
                    assignedBedId: bed.output.selectedBedId,
                    candidateStaff: availableStaff.map((member) => ({
                        staffId: member.staffId,
                        role: member.role,
                        shift: member.shift,
                        available: member.available,
                    })),
                    preferredShift: workflowContext.preferredShift,
                };
                staff = await runDelegation<
                    StaffCoordinationAgentInput,
                    StaffCoordinationAgentOutput
                >("staff_coordination", agents.staff, userId, staffInput);
                delegations.push(staff.log);

                const staffAssignmentInput = {
                    patientId: workflowContext.patientId,
                    staffIds: staff.output.assignedStaffIds,
                };
                const staffAssignmentResult = await withWorkflowSpan(
                    workflowSpanNames.staffAssignment,
                    buildStaffAssignmentTraceAttributes(staffAssignmentInput),
                    async () =>
                        repository.assignStaffToPatient(staffAssignmentInput),
                );
                toolCalls.push({
                    name: "assign_staff_to_patient",
                    args: staffAssignmentInput,
                });
                toolResponses.push({
                    name: "assign_staff_to_patient",
                    response: staffAssignmentResult,
                });
            } else {
                const deferredStaff: StaffCoordinationAgentOutput = {
                    patientId: workflowContext.patientId,
                    assignmentStatus: "deferred",
                    assignedStaffIds: [],
                    assignedRoles: [],
                    alertMessage:
                        "Staff assignment deferred until an eligible bed becomes available.",
                    rationale:
                        "Avoid reserving treatment staff while the patient remains in the bed queue.",
                };
                staff = {
                    output: deferredStaff,
                    log: {
                        agent: agents.staff.name,
                        input: {
                            patientId: workflowContext.patientId,
                            reason: "bed_waitlist",
                        },
                        output: deferredStaff,
                    },
                };
            }

            const snapshot = await repository.loadSnapshot();
            const reportingInput: ReportingAgentInput = {
                patientId: workflowContext.patientId,
                triage: triage.output,
                bedAssignment: bed.output,
                staffAssignment: staff.output,
                censusSummary: buildCensusSummary(snapshot, 120) as Record<
                    string,
                    unknown
                >,
                bedCapacitySummary: buildBedCapacityAnalysis(
                    snapshot,
                ) as Record<string, unknown>,
                staffingSummary: buildStaffingRecommendation(
                    snapshot,
                ) as Record<string, unknown>,
            };
            const reporting = await runDelegation<
                ReportingAgentInput,
                ReportingAgentOutput
            >("reporting", agents.reporting, userId, reportingInput);
            delegations.push(reporting.log);

            const rootInput: RootOrchestratorAgentInput = {
                query: input.query,
                workflowContext,
                triage: triage.output,
                bedAssignment: bed.output,
                staffAssignment: staff.output,
                reporting: reporting.output,
            };
            const root = await runDelegation<
                RootOrchestratorAgentInput,
                RootOrchestratorAgentOutput
            >("root_orchestrator", agents.root, userId, rootInput);
            delegations.push(root.log);

            return {
                response: root.output.response,
                workflow: {
                    triage: triage.output,
                    bedAssignment: bed.output,
                    staffAssignment: staff.output,
                    reporting: reporting.output,
                },
                delegations,
                toolCalls,
                toolResponses,
            };
        },
    );
}
