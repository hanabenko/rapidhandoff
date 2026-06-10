import crypto from "node:crypto";

import { register, SpanStatusCode, trace } from "@arizeai/phoenix-otel";

import type {
    AssignPatientToBedInput,
    AssignStaffToPatientInput,
    GetAvailableBedsInput,
    GetAvailableStaffInput,
    UpsertPatientIntakeInput,
} from "../mcp/schemas.js";
import type {
    OrchestrateInput,
    OrchestrateResult,
} from "../orchestrator.js";

type TraceValue =
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[];
export type TraceAttributes = Record<string, TraceValue | undefined>;

export const workflowSpanNames = {
    orchestrationWorkflow: "er.workflow.orchestration",
    orchestrationRequestReceived: "er.workflow.orchestration.request_received",
    patientIntake: "er.workflow.patient_intake",
    bedLookup: "er.workflow.bed_lookup",
    bedAssignment: "er.workflow.bed_assignment",
    staffLookup: "er.workflow.staff_lookup",
    staffAssignment: "er.workflow.staff_assignment",
    orchestrationResponse: "er.workflow.orchestration.response",
    delegationStart: "er.workflow.delegation.start",
    delegationCompletion: "er.workflow.delegation.complete",
    delegationOutput: "er.workflow.delegation.output",
} as const;

export interface WorkflowSpan {
    setAttributes(attributes: TraceAttributes): void;
    addEvent(name: string, attributes?: TraceAttributes): void;
}

interface WorkflowSpanRunner {
    run<T>(
        name: string,
        attributes: TraceAttributes,
        operation: (span: WorkflowSpan) => Promise<T>,
    ): Promise<T>;
}

interface PhoenixTracerProvider {
    forceFlush?: () => Promise<void>;
    shutdown?: () => Promise<void>;
}

const tracerName = "rapid-handoff-er";
let phoenixTracerProvider: PhoenixTracerProvider | undefined;
let tracingInitialized = false;
let workflowSpanRunner: WorkflowSpanRunner = createOtelWorkflowSpanRunner();

function filterAttributes(attributes: TraceAttributes): Record<string, TraceValue> {
    return Object.fromEntries(
        Object.entries(attributes).filter(
            (entry): entry is [string, TraceValue] => entry[1] !== undefined,
        ),
    );
}

function createOtelWorkflowSpanRunner(): WorkflowSpanRunner {
    return {
        async run<T>(
            name: string,
            attributes: TraceAttributes,
            operation: (span: WorkflowSpan) => Promise<T>,
        ): Promise<T> {
            ensureTracingInitialized();
            const tracer = trace.getTracer(tracerName);

            return tracer.startActiveSpan(name, async (span) => {
                span.setAttributes(filterAttributes(attributes));

                try {
                    const result = await operation({
                        setAttributes(nextAttributes) {
                            span.setAttributes(filterAttributes(nextAttributes));
                        },
                        addEvent(eventName, eventAttributes) {
                            span.addEvent(
                                eventName,
                                eventAttributes
                                    ? filterAttributes(eventAttributes)
                                    : undefined,
                            );
                        },
                    });
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    const exception =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    span.recordException(exception);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: exception.message,
                    });
                    throw error;
                } finally {
                    span.end();
                }
            });
        },
    };
}

function trimmed(value: string | undefined): string | undefined {
    const next = value?.trim();
    return next ? next : undefined;
}

function collectorEndpoint(env: NodeJS.ProcessEnv): string | undefined {
    return (
        trimmed(env.PHOENIX_COLLECTOR_ENDPOINT) ??
        trimmed(env.ARIZE_TRACING_ENDPOINT)
    );
}

function projectName(env: NodeJS.ProcessEnv): string {
    return (
        trimmed(env.PHOENIX_PROJECT) ??
        trimmed(env.ARIZE_PROJECT_NAME) ??
        "rapid-handoff-er"
    );
}

function ageBucket(age: number | undefined): string | undefined {
    if (age === undefined) {
        return undefined;
    }
    if (age < 18) {
        return "child";
    }
    if (age < 40) {
        return "adult_18_39";
    }
    if (age < 65) {
        return "adult_40_64";
    }
    return "adult_65_plus";
}

function hashIdentifier(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function isTracingConfigured(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return Boolean(collectorEndpoint(env));
}

export function ensureTracingInitialized(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (tracingInitialized) {
        return Boolean(phoenixTracerProvider);
    }

    tracingInitialized = true;
    const url = collectorEndpoint(env);
    if (!url) {
        return false;
    }

    try {
        phoenixTracerProvider = register({
            projectName: projectName(env),
            url,
            apiKey: trimmed(env.PHOENIX_API_KEY) ?? trimmed(env.ARIZE_API_KEY),
            batch: false,
        });
        return true;
    } catch (error) {
        console.warn(
            "[tracing] Phoenix OTEL initialization failed:",
            error instanceof Error ? error.message : String(error),
        );
        phoenixTracerProvider = undefined;
        return false;
    }
}

export async function flushTracing(): Promise<void> {
    await phoenixTracerProvider?.forceFlush?.();
}

export async function shutdownTracing(): Promise<void> {
    await phoenixTracerProvider?.shutdown?.();
}

export async function withWorkflowSpan<T>(
    name: string,
    attributes: TraceAttributes,
    operation: (span: WorkflowSpan) => Promise<T>,
): Promise<T> {
    return workflowSpanRunner.run(name, attributes, operation);
}

export function getActiveTraceId(): string | undefined {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    return traceId && !/^0+$/.test(traceId) ? traceId : undefined;
}

export function buildOrchestrationRequestAttributes(
    input: OrchestrateInput,
): TraceAttributes {
    return {
        "rapid_handoff.workflow": "orchestration",
        "rapid_handoff.query_chars": input.query.length,
        "rapid_handoff.context_kind":
            input.context === undefined
                ? "none"
                : typeof input.context === "string"
                  ? "string"
                  : "object",
        "rapid_handoff.context_keys":
            input.context && typeof input.context === "object"
                ? Object.keys(input.context).length
                : undefined,
        "rapid_handoff.user_id_present": Boolean(input.userId),
    };
}

export function buildOrchestrationResponseAttributes(
    result: OrchestrateResult,
): TraceAttributes {
    return {
        "rapid_handoff.agent": result.agent,
        "rapid_handoff.response_chars": result.response.length,
        "rapid_handoff.tool_call_count": result.toolCalls.length,
        "rapid_handoff.tool_response_count": result.toolResponses.length,
    };
}

export function buildWorkflowContextAttributes(context: {
    patientId: string;
    requestedBedType?: string;
    preferredShift?: string;
    requiresMonitor?: boolean;
}): TraceAttributes {
    return {
        "rapid_handoff.workflow": "orchestration",
        "rapid_handoff.patient_ref": hashIdentifier(context.patientId),
        "rapid_handoff.requested_bed_type": context.requestedBedType,
        "rapid_handoff.preferred_shift": context.preferredShift,
        "rapid_handoff.requires_monitor": Boolean(context.requiresMonitor),
    };
}

export function buildPatientIntakeTraceAttributes(
    input: UpsertPatientIntakeInput,
): TraceAttributes {
    return {
        "rapid_handoff.patient_ref": hashIdentifier(input.patientId),
        "rapid_handoff.triage_level": input.triageLevel,
        "rapid_handoff.patient_status": input.status ?? "waiting",
        "rapid_handoff.age_bucket": ageBucket(input.age),
        "rapid_handoff.symptom_count": input.symptoms?.length,
        "rapid_handoff.has_vitals": Boolean(input.vitals),
        "rapid_handoff.arrival_time_provided": Boolean(input.arrivalTime),
        "rapid_handoff.smoke_test": Boolean(input.smokeTestRunId),
    };
}

export function buildBedLookupTraceAttributes(
    input: GetAvailableBedsInput,
): TraceAttributes {
    return {
        "rapid_handoff.bed_type": input.bedType,
        "rapid_handoff.requires_monitor": Boolean(input.requiresMonitor),
        "rapid_handoff.limit": input.limit,
    };
}

export function buildBedAssignmentTraceAttributes(
    input: AssignPatientToBedInput,
): TraceAttributes {
    return {
        "rapid_handoff.patient_ref": hashIdentifier(input.patientId),
        "rapid_handoff.bed_id": input.bedId,
        "rapid_handoff.expected_bed_version": input.expectedBedVersion,
    };
}

export function buildStaffLookupTraceAttributes(
    input: GetAvailableStaffInput,
): TraceAttributes {
    return {
        "rapid_handoff.roles":
            input.roles && input.roles.length > 0
                ? [...input.roles].sort()
                : undefined,
        "rapid_handoff.shift": input.shift,
        "rapid_handoff.limit": input.limit,
    };
}

export function buildStaffAssignmentTraceAttributes(
    input: AssignStaffToPatientInput,
): TraceAttributes {
    return {
        "rapid_handoff.patient_ref": hashIdentifier(input.patientId),
        "rapid_handoff.staff_count": input.staffIds.length,
    };
}

export function buildDelegationStartAttributes(
    agentName: string,
    input: Record<string, unknown>,
): TraceAttributes {
    return {
        "rapid_handoff.delegate_agent": agentName,
        "rapid_handoff.input_field_count": Object.keys(input).length,
    };
}

export function buildDelegationCompletionAttributes(
    agentName: string,
    output: unknown,
): TraceAttributes {
    return {
        "rapid_handoff.delegate_agent": agentName,
        "rapid_handoff.output_kind": Array.isArray(output)
            ? "array"
            : output === null
              ? "null"
              : typeof output,
    };
}

export function buildDelegationOutputAttributes(
    agentName: string,
    output: unknown,
): TraceAttributes {
    return {
        "rapid_handoff.delegate_agent": agentName,
        "rapid_handoff.output_field_count":
            output && typeof output === "object" && !Array.isArray(output)
                ? Object.keys(output as Record<string, unknown>).length
                : undefined,
    };
}

export function setWorkflowSpanRunnerForTests(
    runner: WorkflowSpanRunner | undefined,
): void {
    workflowSpanRunner = runner ?? createOtelWorkflowSpanRunner();
}

export function resetTracingForTests(): void {
    phoenixTracerProvider = undefined;
    tracingInitialized = false;
    workflowSpanRunner = createOtelWorkflowSpanRunner();
}
