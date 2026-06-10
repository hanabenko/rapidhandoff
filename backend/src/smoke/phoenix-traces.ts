import "dotenv/config";

import { PhoenixMcpAdapter } from "../mcp/phoenix.js";
import {
    isTracingConfigured,
    workflowSpanNames,
} from "../observability/tracing.js";

interface PhoenixTrace {
    trace_id?: string;
    spans?: Array<{
        name?: string;
        context?: {
            trace_id?: string;
        };
    }>;
}

const expectedSpanNames = [
    workflowSpanNames.orchestrationRequestReceived,
    workflowSpanNames.patientIntake,
    workflowSpanNames.bedLookup,
    workflowSpanNames.bedAssignment,
    workflowSpanNames.staffLookup,
    workflowSpanNames.staffAssignment,
    workflowSpanNames.orchestrationResponse,
];

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required for pnpm verify:phoenix.`);
    }
    return value;
}

function traceSpanNames(trace: PhoenixTrace): string[] {
    return (trace.spans ?? [])
        .map((span) => span.name)
        .filter((name): name is string => Boolean(name));
}

async function main(): Promise<void> {
    if (!isTracingConfigured()) {
        throw new Error(
            "Phoenix OTEL tracing is not configured. Set PHOENIX_COLLECTOR_ENDPOINT or ARIZE_TRACING_ENDPOINT before verifying traces.",
        );
    }

    requireEnv("PHOENIX_API_KEY");
    requireEnv("PHOENIX_BASE_URL");

    const projectIdentifier =
        process.env.PHOENIX_PROJECT?.trim() || "rapid-handoff-er";
    const lookbackMinutes = Number.parseInt(
        process.env.PHOENIX_VERIFY_LAST_N_MINUTES ?? "60",
        10,
    );

    const adapter = new PhoenixMcpAdapter();
    try {
        const traces = (await adapter.listTraces({
            projectIdentifier,
            limit: 10,
            lastNMinutes: lookbackMinutes,
            includeAnnotations: false,
        })) as PhoenixTrace[];

        if (!Array.isArray(traces) || traces.length === 0) {
            throw new Error(
                `No recent traces were returned for project "${projectIdentifier}" in the last ${lookbackMinutes} minutes.`,
            );
        }

        const matchingTrace = traces.find((trace) => {
            const names = new Set(traceSpanNames(trace));
            return expectedSpanNames.every((name) => names.has(name));
        });

        if (!matchingTrace) {
            const recentSpanNames = traces
                .slice(0, 3)
                .map((trace) =>
                    `${trace.trace_id ?? "unknown-trace"}: ${traceSpanNames(trace).join(", ")}`,
                )
                .join("\n");
            throw new Error(
                `Recent Phoenix traces did not contain the full ER workflow span set.\n${recentSpanNames}`,
            );
        }

        process.stdout.write(
            [
                `[verify:phoenix] project ${projectIdentifier}`,
                `[verify:phoenix] trace ${matchingTrace.trace_id ?? "unknown-trace"}`,
                `[verify:phoenix] spans ${traceSpanNames(matchingTrace).join(", ")}`,
            ].join("\n") + "\n",
        );
    } finally {
        await adapter.close();
    }
}

main().catch((error) => {
    process.stderr.write(
        `[verify:phoenix] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
});
