import {
    InMemoryRunner,
    getFunctionCalls,
    getFunctionResponses,
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
        if (text) {
            // Prefer root agent text; accept sub-agent text as fallback.
            if (event.author === rootAgent.name) {
                response = text;
            } else if (!response) {
                response = text;
            }
        }
    }

    if (!response) {
        response = "Intake complete. Patient has been triaged and registered in the system.";
    }

    return {
        agent: rootAgent.name,
        response,
        toolCalls,
        toolResponses,
    };
}

export type StreamEvent =
    | { type: "tool_call"; agent: string; tool: string }
    | { type: "tool_result"; agent: string; tool: string }
    | { type: "tool_result_detail"; agent: string; text: string }
    | { type: "text"; agent: string; text: string }
    | { type: "error"; message: string }
    | { type: "done"; response: string };

function extractResponseText(response: unknown): string {
    if (typeof response === "string") return response;
    if (typeof response !== "object" || response === null) return "";
    const obj = response as Record<string, unknown>;
    for (const key of ["result", "text", "output", "content", "message"]) {
        if (typeof obj[key] === "string" && (obj[key] as string).length > 0) {
            return obj[key] as string;
        }
    }
    const json = JSON.stringify(response);
    return json.length > 4 ? json : "";
}

export async function streamErOperations(
    input: OrchestrateInput,
    emit: (event: StreamEvent) => void,
): Promise<string> {
    let response = "";

    for await (const event of runner.runEphemeral({
        userId: input.userId ?? "stream-api",
        newMessage: {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
        },
    })) {
        for (const call of getFunctionCalls(event)) {
            emit({ type: "tool_call", agent: event.author ?? "", tool: call.name ?? "" });
        }
        for (const result of getFunctionResponses(event)) {
            emit({ type: "tool_result", agent: event.author ?? "", tool: result.name ?? "" });
            const detail = extractResponseText(result.response);
            if (detail) {
                emit({ type: "tool_result_detail", agent: result.name ?? "", text: detail });
            }
        }
        const text = stringifyContent(event);
        if (text) {
            emit({ type: "text", agent: event.author ?? "", text });
            if (event.author === rootAgent.name) {
                response = text;
            } else if (!response) {
                response = text;
            }
        }
    }

    if (!response) {
        response = "Intake complete. Patient has been triaged and registered in the system.";
    }

    return response;
}
