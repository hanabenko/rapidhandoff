import assert from "node:assert/strict";
import test from "node:test";

import { PhoenixMcpAdapter } from "./phoenix.js";

class RecordingPhoenixClient {
    readonly calls: Array<{
        toolName: string;
        args: Record<string, unknown>;
    }> = [];

    async callTool(toolName: string, args: Record<string, unknown>) {
        this.calls.push({ toolName, args });
        return {
            structuredContent: {
                toolName,
                args,
            },
        };
    }

    async listTools() {
        return { tools: [] };
    }

    async close() {
        return undefined;
    }
}

test("Phoenix MCP adapter uses official trace inspection tools", async () => {
    const client = new RecordingPhoenixClient();
    const adapter = new PhoenixMcpAdapter(
        client as unknown as ConstructorParameters<typeof PhoenixMcpAdapter>[0],
    );

    await adapter.listProjects({ limit: 5 });
    await adapter.listTraces({
        projectIdentifier: "rapid-handoff-er",
        lastNMinutes: 15,
        limit: 3,
    });
    await adapter.getTrace({
        projectIdentifier: "rapid-handoff-er",
        traceId: "trace-123",
    });
    await adapter.getSpans({
        projectIdentifier: "rapid-handoff-er",
        traceIds: ["trace-123"],
        names: ["er.workflow.patient_intake"],
        limit: 20,
    });

    assert.deepEqual(
        client.calls.map((call) => call.toolName),
        ["list-projects", "list-traces", "get-trace", "get-spans"],
    );
    assert.deepEqual(client.calls[1]?.args, {
        project_identifier: "rapid-handoff-er",
        limit: 3,
        last_n_minutes: 15,
    });
});
