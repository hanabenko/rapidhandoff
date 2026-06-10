import { RemoteMcpClient } from "./client.js";
import { getPhoenixMcpConfig } from "./config.js";

function extractMcpPayload(result: unknown): unknown {
    if (!result || typeof result !== "object") {
        return result;
    }

    const record = result as Record<string, unknown>;
    if (record.structuredContent !== undefined) {
        return record.structuredContent;
    }

    if (!Array.isArray(record.content)) {
        return result;
    }

    for (const item of record.content) {
        if (
            item &&
            typeof item === "object" &&
            (item as Record<string, unknown>).type === "text" &&
            typeof (item as Record<string, unknown>).text === "string"
        ) {
            const text = (item as Record<string, unknown>).text as string;
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        }
    }

    return result;
}

export class PhoenixMcpAdapter {
    constructor(
        private readonly client: Pick<
            RemoteMcpClient,
            "callTool" | "listTools" | "close"
        > = new RemoteMcpClient("phoenix", getPhoenixMcpConfig()),
    ) {}

    callTool(
        toolName: string,
        input: Record<string, unknown> = {},
    ): Promise<unknown> {
        return this.client.callTool(toolName, input);
    }

    listTools(): Promise<unknown> {
        return this.client.listTools();
    }

    async listProjects(input: {
        limit?: number;
        cursor?: string;
        includeExperimentProjects?: boolean;
    } = {}): Promise<unknown> {
        return extractMcpPayload(
            await this.callTool("list-projects", {
                ...(input.limit ? { limit: input.limit } : {}),
                ...(input.cursor ? { cursor: input.cursor } : {}),
                ...(input.includeExperimentProjects !== undefined
                    ? {
                          include_experiment_projects:
                              input.includeExperimentProjects,
                      }
                    : {}),
            }),
        );
    }

    async listTraces(input: {
        projectIdentifier?: string;
        limit?: number;
        since?: string;
        lastNMinutes?: number;
        includeAnnotations?: boolean;
    } = {}): Promise<unknown> {
        return extractMcpPayload(
            await this.callTool("list-traces", {
                ...(input.projectIdentifier
                    ? { project_identifier: input.projectIdentifier }
                    : {}),
                ...(input.limit ? { limit: input.limit } : {}),
                ...(input.since ? { since: input.since } : {}),
                ...(input.lastNMinutes
                    ? { last_n_minutes: input.lastNMinutes }
                    : {}),
                ...(input.includeAnnotations !== undefined
                    ? { include_annotations: input.includeAnnotations }
                    : {}),
            }),
        );
    }

    async getTrace(input: {
        traceId: string;
        projectIdentifier?: string;
        includeAnnotations?: boolean;
    }): Promise<unknown> {
        return extractMcpPayload(
            await this.callTool("get-trace", {
                trace_id: input.traceId,
                ...(input.projectIdentifier
                    ? { project_identifier: input.projectIdentifier }
                    : {}),
                ...(input.includeAnnotations !== undefined
                    ? { include_annotations: input.includeAnnotations }
                    : {}),
            }),
        );
    }

    async getSpans(input: {
        projectIdentifier?: string;
        startTime?: string;
        endTime?: string;
        traceIds?: string[];
        names?: string[];
        limit?: number;
        includeAnnotations?: boolean;
    }): Promise<unknown> {
        return extractMcpPayload(
            await this.callTool("get-spans", {
                ...(input.projectIdentifier
                    ? { project_identifier: input.projectIdentifier }
                    : {}),
                ...(input.startTime ? { start_time: input.startTime } : {}),
                ...(input.endTime ? { end_time: input.endTime } : {}),
                ...(input.traceIds ? { trace_ids: input.traceIds } : {}),
                ...(input.names ? { names: input.names } : {}),
                ...(input.limit ? { limit: input.limit } : {}),
                ...(input.includeAnnotations !== undefined
                    ? { include_annotations: input.includeAnnotations }
                    : {}),
            }),
        );
    }

    close(): Promise<void> {
        return this.client.close();
    }
}
