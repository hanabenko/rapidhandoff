import {
    InMemoryRunner,
    getFunctionCalls,
    getFunctionResponses,
    isFinalResponse,
    stringifyContent,
} from "@google/adk";

import { rootAgent } from "./agents/orchestrator_agent/agent.js";
import { canUseDelegatedWorkflow, runDelegatedErWorkflow } from "./agents/orchestrator_agent/delegation.js";
import {
    buildOrchestrationRequestAttributes,
    buildOrchestrationResponseAttributes,
    getActiveTraceId,
    withWorkflowSpan,
    workflowSpanNames,
} from "./observability/tracing.js";
import type {
    BedManagementAgentOutput,
} from "./agents/bed_management_agent/contracts.js";
import type {
    ReportingAgentOutput,
} from "./agents/reporting_agent/contracts.js";
import type {
    StaffCoordinationAgentOutput,
} from "./agents/staff_coordination_agent/contracts.js";
import type {
    TriageAgentOutput,
} from "./agents/triage_agent/contracts.js";

const runner = new InMemoryRunner({
    agent: rootAgent,
    appName: "rapid_handoff_er",
});

export interface OrchestrateInput {
    query: string;
    context?: string | Record<string, unknown>;
    userId?: string;
}

export interface OrchestrateResult {
    agent: string;
    response: string;
    traceId?: string;
    workflow?: {
        triage: TriageAgentOutput;
        bedAssignment: BedManagementAgentOutput;
        staffAssignment: StaffCoordinationAgentOutput;
        reporting: ReportingAgentOutput;
    };
    toolCalls: Array<{
        name?: string;
        args?: Record<string, unknown>;
    }>;
    toolResponses: Array<{
        name?: string;
        response?: unknown;
    }>;
}

interface OrchestrationRunner {
    runEphemeral(input: {
        userId: string;
        newMessage: {
            role: "user";
            parts: Array<{ text: string }>;
        };
    }): AsyncIterable<unknown>;
}

type AdkEvent = Parameters<typeof getFunctionCalls>[0];

function buildPrompt(input: OrchestrateInput): string {
    if (input.context === undefined) {
        return input.query;
    }

    const context =
        typeof input.context === "string"
            ? input.context
            : JSON.stringify(input.context, null, 2);

    return `Operational context:\n${context}\n\nUser query:\n${input.query}`;
}

export async function orchestrateErOperations(
    input: OrchestrateInput,
    dependencies: {
        runner?: OrchestrationRunner;
    } = {},
): Promise<OrchestrateResult> {
    if (canUseDelegatedWorkflow(input)) {
        return withWorkflowSpan(
            workflowSpanNames.orchestrationWorkflow,
            {
                ...buildOrchestrationRequestAttributes(input),
                "rapid_handoff.execution_mode": "delegated_multi_agent",
            },
            async () => {
                const delegated = await runDelegatedErWorkflow(input);
                const result: OrchestrateResult = {
                    agent: rootAgent.name,
                    response: delegated.response,
                    traceId: getActiveTraceId(),
                    workflow: delegated.workflow,
                    toolCalls: delegated.toolCalls,
                    toolResponses: delegated.toolResponses,
                };

                await withWorkflowSpan(
                    workflowSpanNames.orchestrationResponse,
                    buildOrchestrationResponseAttributes(result),
                    async () => result,
                );
                return result;
            },
        );
    }

    const activeRunner = dependencies.runner ?? runner;

    return withWorkflowSpan(
        workflowSpanNames.orchestrationWorkflow,
        {
            "rapid_handoff.workflow": "orchestration",
        },
        async (workflowSpan) => {
            await withWorkflowSpan(
                workflowSpanNames.orchestrationRequestReceived,
                buildOrchestrationRequestAttributes(input),
                async () => undefined,
            );

            let response = "";
            const toolCalls: OrchestrateResult["toolCalls"] = [];
            const toolResponses: OrchestrateResult["toolResponses"] = [];

            try {
                for await (const event of activeRunner.runEphemeral({
                    userId: input.userId ?? "cloud-run-api",
                    newMessage: {
                        role: "user",
                        parts: [{ text: buildPrompt(input) }],
                    },
                })) {
                    const adkEvent = event as AdkEvent;
                    toolCalls.push(
                        ...getFunctionCalls(adkEvent).map((call) => ({
                            name: call.name,
                            args: call.args,
                        })),
                    );
                    toolResponses.push(
                        ...getFunctionResponses(adkEvent).map((result) => ({
                            name: result.name,
                            response: result.response,
                        })),
                    );

                    const text = stringifyContent(adkEvent);
                    if (text && (isFinalResponse(adkEvent) || !response)) {
                        response = text;
                    }
                }

                if (!response) {
                    throw new Error(
                        "The ER orchestrator completed without a text response.",
                    );
                }

                const result: OrchestrateResult = {
                    agent: rootAgent.name,
                    response,
                    toolCalls,
                    toolResponses,
                };

                await withWorkflowSpan(
                    workflowSpanNames.orchestrationResponse,
                    buildOrchestrationResponseAttributes(result),
                    async () => result,
                );

                workflowSpan.addEvent("orchestration.completed", {
                    "rapid_handoff.tool_call_count": toolCalls.length,
                    "rapid_handoff.tool_response_count": toolResponses.length,
                });

                return result;
            } catch (error) {
                workflowSpan.addEvent("orchestration.failed", {
                    "rapid_handoff.tool_call_count": toolCalls.length,
                    "rapid_handoff.tool_response_count": toolResponses.length,
                });
                throw error;
            }
        },
    );
}
