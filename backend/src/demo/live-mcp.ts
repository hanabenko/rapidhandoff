import { register, SpanStatusCode } from "@arizeai/phoenix-otel";
import { z } from "zod";

import { RemoteMcpClient } from "../mcp/client.js";
import { getMongoMcpConfig, getPhoenixMcpConfig } from "../mcp/config.js";
import {
    assignPatientToBedInputSchema,
    getAvailableBedsInputSchema,
    getAvailableStaffInputSchema,
    logArizeTraceInputSchema,
    updateSupplyInventoryInputSchema,
    type AssignPatientToBedInput,
    type GetAvailableBedsInput,
    type GetAvailableStaffInput,
    type LogArizeTraceInput,
    type UpdateSupplyInventoryInput,
} from "../mcp/schemas.js";

export interface DemoBed {
    bedId: string;
    room: string;
    type: string;
    status: string;
    needsCleaning?: boolean;
    hasMonitor?: boolean;
    version?: number;
}

export interface DemoStaff {
    staffId: string;
    name: string;
    role: "physician" | "nurse" | "charge_nurse" | "paramedic" | "tech";
    shift?: string;
    available: boolean;
}

export interface DemoSupply {
    supplyId: string;
    name: string;
    quantity: number;
    reorderLevel?: number;
}

export interface DemoDashboardData {
    activePatientsBeforeArrival: number;
    waitingPatientsBeforeArrival: number;
    averageWaitTimeMinutesBeforeArrival: number;
    totalBeds: number;
    occupiedBedsBeforeAssignment: number;
    scheduledStaff: number;
    availableStaffBeforeAssignment: number;
}

export interface DemoMongoMcpPort {
    readonly auditLog: Array<{ tool: string; input: Record<string, unknown> }>;
    getHistoricalCases(): Promise<Array<Record<string, unknown>>>;
    getDashboardData(): Promise<DemoDashboardData>;
    getAvailableBeds(input: GetAvailableBedsInput): Promise<DemoBed[]>;
    assignPatientToBed(input: AssignPatientToBedInput): Promise<unknown>;
    getAvailableStaff(input: GetAvailableStaffInput): Promise<DemoStaff[]>;
    getSupply(name: string): Promise<DemoSupply | undefined>;
    updateSupplyInventory(input: UpdateSupplyInventoryInput): Promise<unknown>;
    close?(): Promise<void>;
}

export interface DemoTracePort {
    readonly auditLog: Array<{ tool: string; input: Record<string, unknown> }>;
    logTrace(input: LogArizeTraceInput): Promise<{
        eventId: string;
        status: string;
    }>;
    close?(): Promise<void>;
}

const bedSchema = z.object({
    bedId: z.string(),
    room: z.string().default("unknown"),
    type: z.string(),
    status: z.string().default("available"),
    needsCleaning: z.boolean().optional(),
    hasMonitor: z.boolean().optional(),
    version: z.number().int().optional(),
});

const staffSchema = z.object({
    staffId: z.string(),
    name: z.string(),
    role: z.enum(["physician", "nurse", "charge_nurse", "paramedic", "tech"]),
    shift: z.string().optional(),
    available: z.boolean().default(true),
});

const supplySchema = z.object({
    supplyId: z.string(),
    name: z.string(),
    quantity: z.number(),
    reorderLevel: z.number().optional(),
});

function extractMcpPayload(result: unknown): unknown {
    if (!result || typeof result !== "object") {
        return result;
    }

    const record = result as Record<string, unknown>;
    if (record.structuredContent !== undefined) {
        return record.structuredContent;
    }

    if (Array.isArray(record.content)) {
        for (const item of record.content) {
            if (
                item &&
                typeof item === "object" &&
                (item as Record<string, unknown>).type === "text"
            ) {
                const text = (item as Record<string, unknown>).text;
                if (typeof text === "string") {
                    try {
                        return JSON.parse(text);
                    } catch {
                        return text;
                    }
                }
            }
        }
    }

    return result;
}

function extractArray(payload: unknown, keys: string[]): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (!payload || typeof payload !== "object") {
        return [];
    }

    const record = payload as Record<string, unknown>;
    for (const key of keys) {
        if (Array.isArray(record[key])) {
            return record[key];
        }
    }
    return [];
}

function numberField(payload: unknown, names: string[], fallback = 0): number {
    if (!payload || typeof payload !== "object") {
        return fallback;
    }
    const record = payload as Record<string, unknown>;
    for (const name of names) {
        const value = record[name];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
}

export class LiveMongoDemoMcp implements DemoMongoMcpPort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];
    private readonly client: RemoteMcpClient;
    private readonly database: string;

    constructor(env: NodeJS.ProcessEnv = process.env) {
        this.database = env.MONGODB_MCP_DATABASE ?? "er_system";
        this.client = new RemoteMcpClient(
            "mongodb-live-demo",
            getMongoMcpConfig(env),
        );
    }

    async getHistoricalCases(): Promise<Array<Record<string, unknown>>> {
        const payload = await this.call("find", {
            database: this.database,
            collection: "historical_cases",
            filter: {
                operationalPattern: {
                    $in: [
                        "shock_signs_with_hypoxia",
                        "altered_responsiveness_with_hypotension",
                    ],
                },
            },
            limit: 10,
        });
        return extractArray(payload, ["documents", "results", "items"]).filter(
            (item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object"),
        );
    }

    async getAvailableBeds(input: GetAvailableBedsInput): Promise<DemoBed[]> {
        const parsed = getAvailableBedsInputSchema.parse(input);
        const payload = await this.call("get_available_beds", parsed);
        return z
            .array(bedSchema)
            .parse(extractArray(payload, ["beds", "results", "items"]));
    }

    async assignPatientToBed(input: AssignPatientToBedInput): Promise<unknown> {
        const parsed = assignPatientToBedInputSchema.parse(input);
        return this.call("assign_patient_to_bed", parsed);
    }

    async getAvailableStaff(
        input: GetAvailableStaffInput,
    ): Promise<DemoStaff[]> {
        const parsed = getAvailableStaffInputSchema.parse(input);
        const payload = await this.call("get_available_staff", parsed);
        return z
            .array(staffSchema)
            .parse(extractArray(payload, ["staff", "results", "items"]));
    }

    async getSupply(name: string): Promise<DemoSupply | undefined> {
        const payload = await this.call("find", {
            database: this.database,
            collection: "supplies",
            filter: { name },
            limit: 1,
        });
        const [supply] = extractArray(payload, [
            "documents",
            "results",
            "items",
        ]);
        return supply ? supplySchema.parse(supply) : undefined;
    }

    async updateSupplyInventory(
        input: UpdateSupplyInventoryInput,
    ): Promise<unknown> {
        const parsed = updateSupplyInventoryInputSchema.parse(input);
        return this.call("update_supply_inventory", parsed);
    }

    async getDashboardData(): Promise<DemoDashboardData> {
        const [patients, beds, staff, supplies, events] = await Promise.all([
            this.call("aggregate", {
                database: this.database,
                collection: "patients",
                pipeline: [
                    {
                        $group: {
                            _id: null,
                            activePatientsBeforeArrival: {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                "$status",
                                                [
                                                    "waiting",
                                                    "in_treatment",
                                                    "admitted",
                                                ],
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                            waitingPatientsBeforeArrival: {
                                $sum: {
                                    $cond: [
                                        { $eq: ["$status", "waiting"] },
                                        1,
                                        0,
                                    ],
                                },
                            },
                        },
                    },
                ],
            }),
            this.call("aggregate", {
                database: this.database,
                collection: "beds",
                pipeline: [
                    {
                        $group: {
                            _id: null,
                            totalBeds: { $sum: 1 },
                            occupiedBedsBeforeAssignment: {
                                $sum: {
                                    $cond: [
                                        { $eq: ["$status", "occupied"] },
                                        1,
                                        0,
                                    ],
                                },
                            },
                        },
                    },
                ],
            }),
            this.call("aggregate", {
                database: this.database,
                collection: "staff",
                pipeline: [
                    {
                        $group: {
                            _id: null,
                            scheduledStaff: { $sum: 1 },
                            availableStaffBeforeAssignment: {
                                $sum: { $cond: ["$available", 1, 0] },
                            },
                        },
                    },
                ],
            }),
            this.call("count", {
                database: this.database,
                collection: "supplies",
                query: {},
            }),
            this.call("count", {
                database: this.database,
                collection: "events",
                query: {},
            }),
        ]);

        const patientSummary =
            extractArray(patients, ["documents", "results", "items"])[0] ??
            patients;
        const bedSummary =
            extractArray(beds, ["documents", "results", "items"])[0] ?? beds;
        const staffSummary =
            extractArray(staff, ["documents", "results", "items"])[0] ?? staff;

        void supplies;
        void events;

        return {
            activePatientsBeforeArrival: numberField(patientSummary, [
                "activePatientsBeforeArrival",
            ]),
            waitingPatientsBeforeArrival: numberField(patientSummary, [
                "waitingPatientsBeforeArrival",
            ]),
            averageWaitTimeMinutesBeforeArrival: numberField(patientSummary, [
                "averageWaitTimeMinutesBeforeArrival",
                "averageWaitTimeMinutes",
            ]),
            totalBeds: numberField(bedSummary, ["totalBeds"]),
            occupiedBedsBeforeAssignment: numberField(bedSummary, [
                "occupiedBedsBeforeAssignment",
                "occupiedBeds",
            ]),
            scheduledStaff: numberField(staffSummary, ["scheduledStaff"]),
            availableStaffBeforeAssignment: numberField(staffSummary, [
                "availableStaffBeforeAssignment",
                "availableStaff",
            ]),
        };
    }

    close(): Promise<void> {
        return this.client.close();
    }

    private async call(
        tool: string,
        input: Record<string, unknown>,
    ): Promise<unknown> {
        this.auditLog.push({ tool, input });
        return extractMcpPayload(await this.client.callTool(tool, input));
    }
}

export class McpPhoenixDemoTrace implements DemoTracePort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];
    private readonly client: RemoteMcpClient;

    constructor(env: NodeJS.ProcessEnv = process.env) {
        this.client = new RemoteMcpClient(
            "phoenix-live-demo",
            getPhoenixMcpConfig(env),
        );
    }

    async logTrace(input: LogArizeTraceInput) {
        const parsed = logArizeTraceInputSchema.parse(input);
        this.auditLog.push({ tool: "log_arize_trace", input: parsed });
        const payload = extractMcpPayload(
            await this.client.callTool("log_arize_trace", parsed),
        );
        const eventId =
            payload && typeof payload === "object"
                ? String(
                      (payload as Record<string, unknown>).eventId ??
                          (payload as Record<string, unknown>).traceId ??
                          parsed.traceId,
                  )
                : parsed.traceId;

        return { status: "logged", eventId };
    }

    close(): Promise<void> {
        return this.client.close();
    }
}

export class PhoenixOtelDemoTrace implements DemoTracePort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];

    constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

    async logTrace(input: LogArizeTraceInput) {
        const parsed = logArizeTraceInputSchema.parse(input);
        this.auditLog.push({ tool: "log_arize_trace", input: parsed });

        const url =
            this.env.PHOENIX_COLLECTOR_ENDPOINT ??
            this.env.ARIZE_TRACING_ENDPOINT;
        if (!url) {
            throw new Error(
                "PHOENIX_COLLECTOR_ENDPOINT or ARIZE_TRACING_ENDPOINT is required.",
            );
        }

        const provider = register({
            projectName:
                this.env.PHOENIX_PROJECT ??
                this.env.ARIZE_PROJECT_NAME ??
                "rapid-handoff-er",
            url,
            apiKey: this.env.PHOENIX_API_KEY ?? this.env.ARIZE_API_KEY,
            batch: false,
            global: false,
        });
        const tracer = provider.getTracer(
            "rapid-handoff-critical-patient-demo",
        );
        const span = tracer.startSpan(parsed.operation);

        try {
            span.setAttributes({
                "rapid_handoff.agent": parsed.agent,
                "rapid_handoff.status": parsed.status,
                "rapid_handoff.trace_id": parsed.traceId,
                "rapid_handoff.input": JSON.stringify(parsed.input ?? null),
                "rapid_handoff.output": JSON.stringify(parsed.output ?? null),
            });
            span.setStatus({ code: SpanStatusCode.OK });
            const eventId = span.spanContext().traceId;
            span.end();
            await provider.forceFlush();
            return { status: "logged", eventId };
        } catch (error) {
            span.recordException(
                error instanceof Error ? error : new Error(String(error)),
            );
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
            });
            span.end();
            throw error;
        } finally {
            await provider.shutdown();
        }
    }
}

export class DisabledDemoTrace implements DemoTracePort {
    readonly auditLog: Array<{
        tool: string;
        input: Record<string, unknown>;
    }> = [];

    async logTrace(input: LogArizeTraceInput) {
        const parsed = logArizeTraceInputSchema.parse(input);
        this.auditLog.push({ tool: "log_arize_trace", input: parsed });
        return {
            status: "disabled",
            eventId: "TRACE-LIVE-NOT-CONFIGURED",
        };
    }
}

export function createLiveTracePort(
    env: NodeJS.ProcessEnv = process.env,
): DemoTracePort {
    if (env.PHOENIX_API_KEY && env.PHOENIX_BASE_URL) {
        return new McpPhoenixDemoTrace(env);
    }
    if (env.PHOENIX_COLLECTOR_ENDPOINT || env.ARIZE_TRACING_ENDPOINT) {
        return new PhoenixOtelDemoTrace(env);
    }
    return new DisabledDemoTrace();
}
