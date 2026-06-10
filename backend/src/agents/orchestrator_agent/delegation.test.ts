import assert from "node:assert/strict";
import test from "node:test";

import type { BeforeModelCallback, LlmResponse } from "@google/adk";

import { runDelegatedErWorkflow } from "./delegation.js";
import {
    createRootOrchestratorAgent,
} from "./agent.js";
import { createBedManagementAgent } from "../bed_management_agent/agent.js";
import { createReportingAgent } from "../reporting_agent/agent.js";
import { createStaffCoordinationAgent } from "../staff_coordination_agent/agent.js";
import { createTriageAgent } from "../triage_agent/agent.js";
import type { MongoErRepository } from "./data.js";
import { setWorkflowSpanRunnerForTests, workflowSpanNames } from "../../observability/tracing.js";

function jsonResponse(payload: Record<string, unknown>): LlmResponse {
    return {
        content: {
            role: "model",
            parts: [{ text: JSON.stringify(payload) }],
        },
    };
}

function createBeforeModelCallback(
    responder: (input: Record<string, unknown>) => Record<string, unknown>,
): BeforeModelCallback {
    return ({ request }) => {
        const text = request.contents.at(-1)?.parts?.[0]?.text;
        if (typeof text !== "string") {
            throw new Error("Expected string agent input.");
        }
        return jsonResponse(responder(JSON.parse(text) as Record<string, unknown>));
    };
}

function repositoryStub(): MongoErRepository {
    return {
        async loadSnapshot() {
            return {
                capturedAt: new Date("2026-06-09T12:00:00.000Z"),
                patients: [
                    {
                        patientId: "P-100",
                        triageLevel: "urgent",
                        status: "waiting",
                        arrivalTime: new Date("2026-06-09T12:00:00.000Z"),
                    },
                ],
                beds: [
                    {
                        bedId: "B-TRAUMA-1",
                        type: "trauma",
                        status: "occupied",
                        needsCleaning: false,
                    },
                    {
                        bedId: "B-EXAM-9",
                        type: "exam",
                        status: "available",
                        needsCleaning: false,
                    },
                ],
                staff: [
                    {
                        staffId: "DOC-7",
                        role: "physician",
                        available: true,
                        currentAssignment: null,
                        shift: "day",
                    },
                    {
                        staffId: "RN-3",
                        role: "nurse",
                        available: true,
                        currentAssignment: null,
                        shift: "day",
                    },
                ],
                events: [],
            };
        },
        async upsertPatientIntake(input) {
            return { status: "updated", patientId: input.patientId };
        },
        async getAvailableBeds() {
            return [
                {
                    bedId: "B-EXAM-9",
                    room: "ER-09",
                    type: "exam",
                    status: "available",
                    needsCleaning: false,
                    hasMonitor: true,
                    version: 4,
                },
            ];
        },
        async assignPatientToBed(input) {
            return { status: "assigned", bedId: input.bedId };
        },
        async getAvailableStaff() {
            return [
                {
                    staffId: "DOC-7",
                    role: "physician",
                    available: true,
                    currentAssignment: null,
                    shift: "day",
                },
                {
                    staffId: "RN-3",
                    role: "nurse",
                    available: true,
                    currentAssignment: null,
                    shift: "day",
                },
            ];
        },
        async assignStaffToPatient(input) {
            return { status: "assigned", staffIds: input.staffIds };
        },
        async updateSupplyInventory() {
            return { status: "updated" };
        },
        async close() {},
    };
}

function createSpanRecorder() {
    const spans: string[] = [];
    return {
        spans,
        runner: {
            async run<T>(
                name: string,
                _attributes: Record<string, unknown>,
                operation: (span: {
                    setAttributes(nextAttributes: Record<string, unknown>): void;
                    addEvent(
                        eventName: string,
                        eventAttributes?: Record<string, unknown>,
                    ): void;
                }) => Promise<T>,
            ) {
                spans.push(name);
                return operation({
                    setAttributes(_nextAttributes) {},
                    addEvent(_eventName, _eventAttributes) {},
                });
            },
        },
    };
}

test("delegated workflow invokes specialized agents and passes outputs forward", async () => {
    const seenInputs: Record<string, Record<string, unknown>> = {};
    const spanRecorder = createSpanRecorder();
    setWorkflowSpanRunnerForTests(spanRecorder.runner);

    try {
        const result = await runDelegatedErWorkflow(
            {
                query: "Create intake, assign a monitored bed, assign staff, and summarize status.",
                context: {
                    patientId: "P-200",
                    age: 67,
                    chiefComplaint: "Shortness of breath",
                    symptoms: ["shortness of breath", "dizziness"],
                    requiresMonitor: true,
                    assignedByStaffId: "CHARGE-1",
                },
                userId: "integration-test",
            },
            {
                repository: repositoryStub(),
                agents: {
                    triage: {
                        agent: createTriageAgent({
                            beforeModelCallback: createBeforeModelCallback(
                                (input) => {
                                    seenInputs.triage = input;
                                    return {
                                        patientId: input.patientId,
                                        severity: "high",
                                        urgency: "expedited",
                                        routingPriority: "monitored_bed",
                                        recommendedBedType: "exam",
                                        requiresMonitor: true,
                                        rationale: "Needs monitored placement.",
                                    };
                                },
                            ),
                        }),
                        inputSchema: undefined as never,
                    },
                    bed: {
                        agent: createBedManagementAgent({
                            beforeModelCallback: createBeforeModelCallback(
                                (input) => {
                                    seenInputs.bed = input;
                                    return {
                                        patientId: input.patientId,
                                        selectedBedId: "B-EXAM-9",
                                        selectedBedType: "exam",
                                        rationale:
                                            "Selected monitored exam bed from candidates.",
                                        estimatedWaitMinutes: 0,
                                    };
                                },
                            ),
                        }),
                        inputSchema: undefined as never,
                    },
                    staff: {
                        agent: createStaffCoordinationAgent({
                            beforeModelCallback: createBeforeModelCallback(
                                (input) => {
                                    seenInputs.staff = input;
                                    return {
                                        patientId: input.patientId,
                                        assignedStaffIds: ["DOC-7", "RN-3"],
                                        assignedRoles: ["physician", "nurse"],
                                        alertMessage:
                                            "DOC-7 and RN-3 report to B-EXAM-9 now.",
                                        rationale:
                                            "Physician and nurse coverage match monitored workflow.",
                                    };
                                },
                            ),
                        }),
                        inputSchema: undefined as never,
                    },
                    reporting: {
                        agent: createReportingAgent({
                            beforeModelCallback: createBeforeModelCallback(
                                (input) => {
                                    seenInputs.reporting = input;
                                    return {
                                        patientId: input.patientId,
                                        operationalSummary:
                                            "Patient P-200 routed to monitored exam bed with physician and nurse coverage.",
                                        dashboardStatus: {
                                            patientId: input.patientId,
                                            triageSeverity: "high",
                                            routingPriority: "monitored_bed",
                                            bedId: "B-EXAM-9",
                                            assignedStaffIds: [
                                                "DOC-7",
                                                "RN-3",
                                            ],
                                            estimatedWaitMinutes: 0,
                                        },
                                        criticalAlerts: [],
                                    };
                                },
                            ),
                        }),
                        inputSchema: undefined as never,
                    },
                    root: {
                        agent: createRootOrchestratorAgent({
                            beforeModelCallback: createBeforeModelCallback(
                                (input) => {
                                    seenInputs.root = input;
                                    return {
                                        response:
                                            "Patient P-200 is queued at B-EXAM-9 with DOC-7 and RN-3 assigned.",
                                    };
                                },
                            ),
                        }),
                        inputSchema: undefined as never,
                    },
                },
            },
        );

        assert.match(result.response, /B-EXAM-9/);
        assert.equal(
            result.workflow.reporting.dashboardStatus.bedId,
            "B-EXAM-9",
        );
        assert.deepEqual(
            result.delegations.map((delegation) => delegation.agent),
            [
                "triage_agent",
                "bed_management_agent",
                "staff_coordination_agent",
                "reporting_agent",
                "er_operations_orchestrator",
            ],
        );
        assert.equal(seenInputs.bed?.recommendedBedType, "exam");
        assert.equal(seenInputs.staff?.assignedBedId, "B-EXAM-9");
        assert.equal(seenInputs.reporting?.patientId, "P-200");
        assert.equal(
            (
                (
                    seenInputs.root?.reporting as {
                        dashboardStatus?: { bedId?: string };
                    }
                )?.dashboardStatus?.bedId
            ),
            "B-EXAM-9",
        );
        assert.ok(
            spanRecorder.spans.includes(workflowSpanNames.delegationStart),
        );
        assert.ok(
            spanRecorder.spans.includes(workflowSpanNames.delegationCompletion),
        );
        assert.ok(
            spanRecorder.spans.includes(workflowSpanNames.delegationOutput),
        );
    } finally {
        setWorkflowSpanRunnerForTests(undefined);
    }
});

test("delegated workflow surfaces ADK model errors from sub-agents", async () => {
    const failingTriageAgent = createTriageAgent({
        beforeModelCallback: () => ({
            errorCode: "UNKNOWN_ERROR",
            errorMessage: "Could not load the default credentials.",
        }),
    });

    await assert.rejects(
        runDelegatedErWorkflow(
            {
                query: "Create intake and coordinate the ER workflow.",
                context: {
                    patientId: "P-AUTH-1",
                    chiefComplaint: "Demo concern",
                    assignedByStaffId: "CHARGE-1",
                },
            },
            {
                repository: repositoryStub(),
                agents: {
                    triage: {
                        agent: failingTriageAgent,
                        inputSchema: undefined as never,
                    },
                },
            },
        ),
        /triage_agent model request failed: Could not load the default credentials/,
    );
});

test("delegated workflow completes with a waitlist result when no beds are available", async () => {
    const repository = repositoryStub();
    let assignmentWrites = 0;
    repository.getAvailableBeds = async () => [];
    repository.assignPatientToBed = async () => {
        assignmentWrites += 1;
        return {};
    };
    repository.assignStaffToPatient = async () => {
        assignmentWrites += 1;
        return {};
    };

    const result = await runDelegatedErWorkflow(
        {
            query: "Create intake and coordinate the ER workflow.",
            context: {
                patientId: "P-WAIT-1",
                chiefComplaint: "Demo concern",
                assignedByStaffId: "CHARGE-1",
            },
        },
        {
            repository,
            agents: {
                triage: {
                    agent: createTriageAgent({
                        beforeModelCallback: createBeforeModelCallback(
                            (input) => ({
                                patientId: input.patientId,
                                severity: "moderate",
                                urgency: "standard",
                                routingPriority: "standard_bed",
                                recommendedBedType: "exam",
                                requiresMonitor: false,
                                rationale: "Stable intake.",
                            }),
                        ),
                    }),
                    inputSchema: undefined as never,
                },
                bed: {
                    agent: createBedManagementAgent({
                        beforeModelCallback: createBeforeModelCallback(
                            (input) => ({
                                patientId: input.patientId,
                                assignmentStatus: "waitlisted",
                                selectedBedId: null,
                                selectedBedType: "exam",
                                rationale: "No bed available.",
                                estimatedWaitMinutes: 30,
                            }),
                        ),
                    }),
                    inputSchema: undefined as never,
                },
                reporting: {
                    agent: createReportingAgent({
                        beforeModelCallback: createBeforeModelCallback(
                            (input) => ({
                                patientId: input.patientId,
                                operationalSummary:
                                    "Patient remains queued pending an exam bed.",
                                dashboardStatus: {
                                    patientId: input.patientId,
                                    triageSeverity: "moderate",
                                    routingPriority: "standard_bed",
                                    bedId: null,
                                    assignedStaffIds: [],
                                    estimatedWaitMinutes: 30,
                                },
                                criticalAlerts: [
                                    "No eligible bed is currently available.",
                                ],
                            }),
                        ),
                    }),
                    inputSchema: undefined as never,
                },
                root: {
                    agent: createRootOrchestratorAgent({
                        includeDelegationTools: false,
                        beforeModelCallback: createBeforeModelCallback(() => ({
                            response:
                                "Patient P-WAIT-1 is triaged and waitlisted for an exam bed.",
                        })),
                    }),
                    inputSchema: undefined as never,
                },
            },
        },
    );

    assert.equal(result.workflow.bedAssignment.assignmentStatus, "waitlisted");
    assert.equal(result.workflow.bedAssignment.selectedBedId, null);
    assert.equal(result.workflow.staffAssignment.assignmentStatus, "deferred");
    assert.deepEqual(result.workflow.staffAssignment.assignedStaffIds, []);
    assert.equal(assignmentWrites, 0);
});
