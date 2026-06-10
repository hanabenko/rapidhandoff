import assert from "node:assert/strict";
import test from "node:test";

import {
    buildOrchestrationRequestAttributes,
    buildPatientIntakeTraceAttributes,
    setWorkflowSpanRunnerForTests,
    withWorkflowSpan,
    workflowSpanNames,
} from "./tracing.js";

function createRecordingRunner() {
    const spans: Array<{
        name: string;
        attributes: Record<string, unknown>;
        events: Array<{
            name: string;
            attributes?: Record<string, unknown>;
        }>;
    }> = [];

    return {
        spans,
        runner: {
            async run<T>(
                name: string,
                attributes: Record<string, unknown>,
                operation: (span: {
                    setAttributes(nextAttributes: Record<string, unknown>): void;
                    addEvent(
                        eventName: string,
                        eventAttributes?: Record<string, unknown>,
                    ): void;
                }) => Promise<T>,
            ): Promise<T> {
                const span = {
                    name,
                    attributes: { ...attributes },
                    events: [] as Array<{
                        name: string;
                        attributes?: Record<string, unknown>;
                    }>,
                };
                spans.push(span);
                return operation({
                    setAttributes(nextAttributes) {
                        Object.assign(span.attributes, nextAttributes);
                    },
                    addEvent(eventName, eventAttributes) {
                        span.events.push({
                            name: eventName,
                            attributes: eventAttributes,
                        });
                    },
                });
            },
        },
    };
}

test("orchestration request trace attributes record shape without raw content", () => {
    const attributes = buildOrchestrationRequestAttributes({
        query: "Assign Jane Doe to a monitored trauma bed.",
        context: {
            patientId: "P-1",
            note: "Do not trace this",
        },
        userId: "dispatcher-1",
    });

    assert.equal(attributes["rapid_handoff.query_chars"], 42);
    assert.equal(attributes["rapid_handoff.context_kind"], "object");
    assert.equal(attributes["rapid_handoff.context_keys"], 2);
    assert.equal(attributes["rapid_handoff.user_id_present"], true);
    assert.equal(
        "rapid_handoff.query" in attributes,
        false,
        "raw query text should not be traced",
    );
});

test("patient intake trace attributes omit sensitive patient fields", () => {
    const attributes = buildPatientIntakeTraceAttributes({
        patientId: "PAT-12345",
        name: "Jane Doe",
        chiefComplaint: "Chest pain",
        symptoms: ["pain", "nausea"],
        age: 72,
        triageLevel: "critical",
        status: "waiting",
    });

    assert.equal(attributes["rapid_handoff.triage_level"], "critical");
    assert.equal(attributes["rapid_handoff.age_bucket"], "adult_65_plus");
    assert.equal(attributes["rapid_handoff.symptom_count"], 2);
    assert.equal(typeof attributes["rapid_handoff.patient_ref"], "string");
    assert.equal("rapid_handoff.name" in attributes, false);
    assert.equal("rapid_handoff.chief_complaint" in attributes, false);
});

test("workflow span helper supports nested ER workflow spans in tests", async () => {
    const recorder = createRecordingRunner();
    setWorkflowSpanRunnerForTests(recorder.runner);

    try {
        await withWorkflowSpan(
            workflowSpanNames.orchestrationRequestReceived,
            { "rapid_handoff.query_chars": 12 },
            async (span) => {
                span.addEvent("request.validated");
                await withWorkflowSpan(
                    workflowSpanNames.orchestrationResponse,
                    { "rapid_handoff.tool_call_count": 3 },
                    async () => undefined,
                );
            },
        );
    } finally {
        setWorkflowSpanRunnerForTests(undefined);
    }

    assert.deepEqual(
        recorder.spans.map((span) => span.name),
        [
            workflowSpanNames.orchestrationRequestReceived,
            workflowSpanNames.orchestrationResponse,
        ],
    );
    assert.equal(recorder.spans[0]?.events[0]?.name, "request.validated");
});
