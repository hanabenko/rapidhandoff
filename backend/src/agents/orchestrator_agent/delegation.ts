import {
    InMemoryRunner,
    isFinalResponse,
    stringifyContent,
    type Event,
    type LlmAgent,
} from "@google/adk";
import { randomUUID } from "node:crypto";

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
import { applyBedGuardrails } from "../bed_management_agent/guardrails.js";
import {
    reportingAgentInputSchema,
    type ReportingAgentInput,
    type ReportingAgentOutput,
} from "../reporting_agent/contracts.js";
import { reportingAgent } from "../reporting_agent/agent.js";
import { applyReportingGuardrails } from "../reporting_agent/guardrails.js";
import {
    staffCoordinationAgentInputSchema,
    type StaffCoordinationAgentInput,
    type StaffCoordinationAgentOutput,
} from "../staff_coordination_agent/contracts.js";
import { staffCoordinationAgent } from "../staff_coordination_agent/agent.js";
import { applyStaffGuardrails } from "../staff_coordination_agent/guardrails.js";
import {
    triageAgentInputSchema,
    type TriageAgentInput,
    type TriageAgentOutput,
} from "../triage_agent/contracts.js";
import { triageAgent } from "../triage_agent/agent.js";
import { applyTriageGuardrails } from "../triage_agent/guardrails.js";
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

export interface AgentTimelineStep {
    order: number;
    agent: string;
    status: "completed" | "waitlisted" | "deferred";
    inputSummary: string;
    outputSummary: string;
    appliedRules: string[];
    toolActions: Array<{
        tool: string;
        status: string;
    }>;
}

export interface ExecutionEvidence {
    patientRecordId: string;
    patientWriteStatus: string;
    bedAssignmentStatus: string;
    staffAssignmentStatus: string;
    workflowId: string;
}

export interface DelegatedWorkflowResult {
    workflowId: string;
    executionMode: AgentExecutionMode;
    modelCallCount: number;
    response: string;
    workflow: {
        triage: TriageAgentOutput;
        bedAssignment: BedManagementAgentOutput;
        staffAssignment: StaffCoordinationAgentOutput;
        reporting: ReportingAgentOutput;
    };
    delegations: DelegationLog[];
    agentTimeline: AgentTimelineStep[];
    executionEvidence: ExecutionEvidence;
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
    executionMode?: AgentExecutionMode;
}

export type AgentExecutionMode = "adaptive" | "policy" | "full_llm";

interface StructuredAgentRunResult<TOutput> {
    output: TOutput;
    responseText: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function resultStatus(result: unknown, fallback: string): string {
    return (
        (asObject(result)?.status as string | undefined) ??
        fallback
    );
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

async function runPolicyDelegation<
    TInput extends Record<string, unknown>,
    TOutput,
>(
    name: string,
    agentName: string,
    input: TInput,
    decide: () => TOutput,
): Promise<{ output: TOutput; log: DelegationLog }> {
    await withWorkflowSpan(
        workflowSpanNames.delegationStart,
        {
            ...buildDelegationStartAttributes(name, input),
            "rapid_handoff.delegation_engine": "deterministic_policy",
        },
        async () => undefined,
    );

    const output = decide();

    await withWorkflowSpan(
        workflowSpanNames.delegationOutput,
        {
            ...buildDelegationOutputAttributes(name, output),
            "rapid_handoff.delegation_engine": "deterministic_policy",
        },
        async () => undefined,
    );
    await withWorkflowSpan(
        workflowSpanNames.delegationCompletion,
        {
            ...buildDelegationCompletionAttributes(name, output),
            "rapid_handoff.delegation_engine": "deterministic_policy",
        },
        async () => undefined,
    );

    return {
        output,
        log: {
            agent: agentName,
            input,
            output: asObject(output) ?? { result: output },
        },
    };
}

function buildPolicyTriageProposal(
    input: TriageAgentInput,
): TriageAgentOutput {
    return {
        patientId: input.patientId,
        severity: "moderate",
        urgency: "standard",
        routingPriority: "standard_bed",
        recommendedBedType: input.requestedBedType ?? "exam",
        requiresMonitor: input.requiresMonitor ?? false,
        rationale:
            "Applied the configured ESI intake policy to the reported acuity and vital-sign constraints.",
        appliedRules: [],
    };
}

function buildPolicyBedProposal(
    input: BedManagementAgentInput,
): BedManagementAgentOutput {
    const candidate = input.candidateBeds[0];
    return {
        patientId: input.patientId,
        assignmentStatus: candidate ? "assigned" : "waitlisted",
        selectedBedId: candidate?.bedId ?? null,
        selectedBedType: candidate?.type ?? input.recommendedBedType,
        rationale: candidate
            ? "Selected from the repository-provided eligible bed candidates."
            : "No eligible bed candidate is currently available.",
        estimatedWaitMinutes: candidate ? 0 : 15,
        appliedRules: [],
    };
}

function buildPolicyStaffProposal(
    input: StaffCoordinationAgentInput,
): StaffCoordinationAgentOutput {
    return {
        patientId: input.patientId,
        assignmentStatus: "deferred",
        assignedStaffIds: [],
        assignedRoles: [],
        alertMessage: `Evaluate available role coverage for ${input.assignedBedId}.`,
        rationale:
            "Role, specialty, shift, and availability constraints determine the assignment.",
        appliedRules: [],
    };
}

function buildPolicyReportingProposal(
    input: ReportingAgentInput,
): ReportingAgentOutput {
    const bedSummary =
        input.bedAssignment.selectedBedId === null
            ? `waitlisted for ${input.bedAssignment.selectedBedType}`
            : `assigned to ${input.bedAssignment.selectedBedId}`;
    const staffSummary =
        input.staffAssignment.assignedStaffIds.length === 0
            ? "staff assignment pending"
            : `${input.staffAssignment.assignedStaffIds.length} staff assigned`;

    return {
        patientId: input.patientId,
        operationalSummary: `ESI ${input.triage.esiLevel ?? "unassigned"} ${input.triage.severity} intake; ${bedSummary}; ${staffSummary}.`,
        dashboardStatus: {
            patientId: input.patientId,
            triageSeverity: input.triage.severity,
            routingPriority: input.triage.routingPriority,
            bedId: input.bedAssignment.selectedBedId,
            assignedStaffIds: input.staffAssignment.assignedStaffIds,
            estimatedWaitMinutes:
                input.bedAssignment.estimatedWaitMinutes,
        },
        criticalAlerts: [],
        appliedRules: [],
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

function preferredSpecialties(
    routingPriority: TriageAgentOutput["routingPriority"],
): string[] {
    if (
        routingPriority === "resuscitation" ||
        routingPriority === "trauma_bay"
    ) {
        return ["emergency", "trauma"];
    }
    return ["emergency"];
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
    const workflowId = randomUUID();
    const executionMode =
        dependencies.executionMode ??
        (dependencies.agents
            ? "full_llm"
            : process.env.ER_AGENT_EXECUTION_MODE === "full_llm" ||
                process.env.ER_AGENT_EXECUTION_MODE === "policy"
              ? process.env.ER_AGENT_EXECUTION_MODE
              : "adaptive");
    let modelCallCount = 0;

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
            const patientWriteStatus = resultStatus(intakeResult, "written");

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
            const useTriageModel =
                executionMode === "full_llm" ||
                (executionMode === "adaptive" &&
                    !triageInput.reportedTriageLevel);
            const triage = useTriageModel
                ? await runDelegation<TriageAgentInput, TriageAgentOutput>(
                      "triage",
                      agents.triage,
                      userId,
                      triageInput,
                  )
                : await runPolicyDelegation<
                      TriageAgentInput,
                      TriageAgentOutput
                  >("triage", agents.triage.name, triageInput, () =>
                      buildPolicyTriageProposal(triageInput),
                  );
            if (useTriageModel) {
                modelCallCount += 1;
            }
            triage.output = applyTriageGuardrails(
                triageInput,
                triage.output,
            );
            triage.log.output = asObject(triage.output) ?? {};
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
            const bed =
                executionMode === "full_llm"
                    ? await runDelegation<
                          BedManagementAgentInput,
                          BedManagementAgentOutput
                      >("bed_management", agents.bed, userId, bedInput)
                    : await runPolicyDelegation<
                          BedManagementAgentInput,
                          BedManagementAgentOutput
                      >(
                          "bed_management",
                          agents.bed.name,
                          bedInput,
                          () => buildPolicyBedProposal(bedInput),
                      );
            if (executionMode === "full_llm") {
                modelCallCount += 1;
            }
            bed.output = applyBedGuardrails(bedInput, bed.output);
            bed.log.output = asObject(bed.output) ?? {};
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
            let bedAssignmentStatus = "waitlisted";
            let staffAssignmentStatus = "deferred";
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
                bedAssignmentStatus = resultStatus(
                    bedAssignmentResult,
                    "assigned",
                );

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
                    preferredSpecialties: preferredSpecialties(
                        triage.output.routingPriority,
                    ),
                    candidateStaff: availableStaff.map((member) => ({
                        staffId: member.staffId,
                        role: member.role,
                        specialty: member.specialty,
                        shift: member.shift,
                        available: member.available,
                    })),
                    preferredShift: workflowContext.preferredShift,
                };
                staff =
                    executionMode === "full_llm"
                        ? await runDelegation<
                              StaffCoordinationAgentInput,
                              StaffCoordinationAgentOutput
                          >(
                              "staff_coordination",
                              agents.staff,
                              userId,
                              staffInput,
                          )
                        : await runPolicyDelegation<
                              StaffCoordinationAgentInput,
                              StaffCoordinationAgentOutput
                          >(
                              "staff_coordination",
                              agents.staff.name,
                              staffInput,
                              () => buildPolicyStaffProposal(staffInput),
                          );
                if (executionMode === "full_llm") {
                    modelCallCount += 1;
                }
                staff.output = applyStaffGuardrails(
                    staffInput,
                    staff.output,
                );
                staff.log.output = asObject(staff.output) ?? {};
                delegations.push(staff.log);

                if (staff.output.assignmentStatus === "assigned") {
                    const staffAssignmentInput = {
                        patientId: workflowContext.patientId,
                        staffIds: staff.output.assignedStaffIds,
                    };
                    const staffAssignmentResult = await withWorkflowSpan(
                        workflowSpanNames.staffAssignment,
                        buildStaffAssignmentTraceAttributes(
                            staffAssignmentInput,
                        ),
                        async () =>
                            repository.assignStaffToPatient(
                                staffAssignmentInput,
                            ),
                    );
                    toolCalls.push({
                        name: "assign_staff_to_patient",
                        args: staffAssignmentInput,
                    });
                    toolResponses.push({
                        name: "assign_staff_to_patient",
                        response: staffAssignmentResult,
                    });
                    staffAssignmentStatus = resultStatus(
                        staffAssignmentResult,
                        "assigned",
                    );
                }
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
                    appliedRules: ["bed_capacity_dependency"],
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
            const reporting =
                executionMode === "full_llm"
                    ? await runDelegation<
                          ReportingAgentInput,
                          ReportingAgentOutput
                      >(
                          "reporting",
                          agents.reporting,
                          userId,
                          reportingInput,
                      )
                    : await runPolicyDelegation<
                          ReportingAgentInput,
                          ReportingAgentOutput
                      >(
                          "reporting",
                          agents.reporting.name,
                          reportingInput,
                          () =>
                              buildPolicyReportingProposal(reportingInput),
                      );
            if (executionMode === "full_llm") {
                modelCallCount += 1;
            }
            reporting.output = applyReportingGuardrails(
                reportingInput,
                reporting.output,
            );
            reporting.log.output = asObject(reporting.output) ?? {};
            delegations.push(reporting.log);

            const rootInput: RootOrchestratorAgentInput = {
                query: input.query,
                workflowContext,
                triage: triage.output,
                bedAssignment: bed.output,
                staffAssignment: staff.output,
                reporting: reporting.output,
            };
            const root =
                executionMode === "full_llm"
                    ? await runDelegation<
                          RootOrchestratorAgentInput,
                          RootOrchestratorAgentOutput
                      >(
                          "root_orchestrator",
                          agents.root,
                          userId,
                          rootInput,
                      )
                    : await runPolicyDelegation<
                          RootOrchestratorAgentInput,
                          RootOrchestratorAgentOutput
                      >(
                          "root_orchestrator",
                          agents.root.name,
                          rootInput,
                          () => ({
                              response:
                                  reporting.output.operationalSummary,
                          }),
                      );
            if (executionMode === "full_llm") {
                modelCallCount += 1;
            }
            delegations.push(root.log);

            const agentTimeline: AgentTimelineStep[] = [
                {
                    order: 1,
                    agent: "triage_agent",
                    status: "completed",
                    inputSummary: `Intake ${workflowContext.patientId}; reported acuity ${workflowContext.triageLevel ?? "unspecified"}.`,
                    outputSummary: `ESI ${triage.output.esiLevel ?? "unassigned"}; ${triage.output.severity} severity; ${triage.output.routingPriority}.`,
                    appliedRules: triage.output.appliedRules,
                    toolActions: [
                        {
                            tool: "upsert_patient_intake",
                            status: patientWriteStatus,
                        },
                    ],
                },
                {
                    order: 2,
                    agent: "bed_management_agent",
                    status:
                        bed.output.assignmentStatus === "waitlisted"
                            ? "waitlisted"
                            : "completed",
                    inputSummary: `${availableBeds.length} eligible bed candidate(s); monitor ${bedInput.requiresMonitor ? "required" : "not required"}.`,
                    outputSummary:
                        bed.output.selectedBedId === null
                            ? `Waitlisted for ${bed.output.selectedBedType}; estimate ${bed.output.estimatedWaitMinutes} minutes.`
                            : `Selected ${bed.output.selectedBedId} (${bed.output.selectedBedType}).`,
                    appliedRules: bed.output.appliedRules,
                    toolActions: [
                        {
                            tool: "get_available_beds",
                            status: `${availableBeds.length}_candidates`,
                        },
                        ...(bed.output.selectedBedId
                            ? [
                                  {
                                      tool: "assign_patient_to_bed",
                                      status: bedAssignmentStatus,
                                  },
                              ]
                            : []),
                    ],
                },
                {
                    order: 3,
                    agent: "staff_coordination_agent",
                    status:
                        staff.output.assignmentStatus === "deferred"
                            ? "deferred"
                            : "completed",
                    inputSummary: `Required coverage for ${triage.output.severity} acuity.`,
                    outputSummary:
                        staff.output.assignedStaffIds.length > 0
                            ? `Assigned ${staff.output.assignedRoles.join(", ")}: ${staff.output.assignedStaffIds.join(", ")}.`
                            : "Staff assignment deferred pending capacity.",
                    appliedRules:
                        staff.output.appliedRules.length > 0
                            ? staff.output.appliedRules
                            : ["bed_capacity_dependency"],
                    toolActions: staff.output.assignedStaffIds.length
                        ? [
                              {
                                  tool: "get_available_staff",
                                  status: "completed",
                              },
                              {
                                  tool: "assign_staff_to_patient",
                                  status: staffAssignmentStatus,
                              },
                          ]
                        : [],
                },
                {
                    order: 4,
                    agent: "reporting_agent",
                    status: "completed",
                    inputSummary:
                        "Validated triage, bed, staff, census, and capacity outputs.",
                    outputSummary: `${reporting.output.criticalAlerts.length} operational alert(s); dashboard state generated.`,
                    appliedRules: reporting.output.appliedRules,
                    toolActions: [
                        { tool: "load_operational_snapshot", status: "read" },
                    ],
                },
                {
                    order: 5,
                    agent: "er_operations_orchestrator",
                    status: "completed",
                    inputSummary:
                        "Received validated specialist outputs and write results.",
                    outputSummary: "Synthesized final ER operational state.",
                    appliedRules: ["specialist_outputs_are_source_of_truth"],
                    toolActions: [],
                },
            ];

            return {
                workflowId,
                executionMode,
                modelCallCount,
                response: root.output.response,
                workflow: {
                    triage: triage.output,
                    bedAssignment: bed.output,
                    staffAssignment: staff.output,
                    reporting: reporting.output,
                },
                delegations,
                agentTimeline,
                executionEvidence: {
                    patientRecordId: workflowContext.patientId,
                    patientWriteStatus,
                    bedAssignmentStatus,
                    staffAssignmentStatus,
                    workflowId,
                },
                toolCalls,
                toolResponses,
            };
        },
    );
}
