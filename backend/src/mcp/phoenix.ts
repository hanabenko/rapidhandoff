import { RemoteMcpClient } from "./client.js";
import { getPhoenixMcpConfig } from "./config.js";
import {
    logArizeTraceInputSchema,
    type LogArizeTraceInput,
} from "./schemas.js";

export class PhoenixMcpAdapter {
    constructor(
        private readonly client = new RemoteMcpClient(
            "phoenix",
            getPhoenixMcpConfig(),
        ),
    ) {}

    logTrace(input: LogArizeTraceInput): Promise<unknown> {
        return this.client.callTool(
            "log_arize_trace",
            logArizeTraceInputSchema.parse(input),
        );
    }

    listTools(): Promise<unknown> {
        return this.client.listTools();
    }

    close(): Promise<void> {
        return this.client.close();
    }
}
