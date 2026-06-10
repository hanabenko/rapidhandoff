import {
    InMemoryRunner,
    getFunctionCalls,
    getFunctionResponses,
    isFinalResponse,
    stringifyContent,
} from "@google/adk";

import { rootAgent } from "./agents/orchestrator_agent/agent.js";

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
    toolCalls: Array<{
        name?: string;
        args?: Record<string, unknown>;
    }>;
    toolResponses: Array<{
        name?: string;
        response?: unknown;
    }>;
}

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
): Promise<OrchestrateResult> {
    let response = "";
    const toolCalls: OrchestrateResult["toolCalls"] = [];
    const toolResponses: OrchestrateResult["toolResponses"] = [];

    for await (const event of runner.runEphemeral({
        userId: input.userId ?? "cloud-run-api",
        newMessage: {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
        },
    })) {
        toolCalls.push(
            ...getFunctionCalls(event).map((call) => ({
                name: call.name,
                args: call.args,
            })),
        );
        toolResponses.push(
            ...getFunctionResponses(event).map((result) => ({
                name: result.name,
                response: result.response,
            })),
        );

        const text = stringifyContent(event);
        if (text && (isFinalResponse(event) || !response)) {
            response = text;
        }
    }

    if (!response) {
        throw new Error("The ER orchestrator completed without a text response.");
    }

    return {
        agent: rootAgent.name,
        response,
        toolCalls,
        toolResponses,
    };
}
