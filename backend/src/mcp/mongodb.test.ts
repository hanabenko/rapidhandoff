import assert from "node:assert/strict";
import test from "node:test";
import { BSON } from "mongodb";

import { MongoErMcpAdapter, type MongoMcpToolClient } from "./mongodb.js";
import {
    setWorkflowSpanRunnerForTests,
    workflowSpanNames,
} from "../observability/tracing.js";

interface RecordedCall {
    tool: string;
    args: Record<string, unknown>;
}

function findResult(documents: Record<string, unknown>[]) {
    return {
        content: [
            {
                type: "text",
                text: `Found ${documents.length} documents in the collection:`,
            },
            {
                type: "text",
                text: BSON.EJSON.stringify(documents),
            },
        ],
    };
}

function updateResult(matched: number, modified = matched, upserted = 0) {
    return {
        content: [
            {
                type: "text",
                text: `Matched ${matched} document(s). Modified ${modified} document(s). Upserted ${upserted} document(s).`,
            },
        ],
        structuredContent: {
            matchedCount: matched,
            modifiedCount: modified,
            upsertedCount: upserted,
        },
    };
}

class RecordingMcpClient implements MongoMcpToolClient {
    readonly calls: RecordedCall[] = [];
    private readonly responder: (
        tool: string,
        args: Record<string, unknown>,
        callIndex: number,
    ) => unknown;

    constructor(
        respond: (
            tool: string,
            args: Record<string, unknown>,
            callIndex: number,
        ) => unknown | Array<unknown>,
    ) {
        // Allow passing an array of canned responses for simpler tests
        if (Array.isArray(respond)) {
            const arr = respond;
            this.responder = () => arr.shift();
        } else {
            this.responder = respond;
        }
    }

    async callTool(tool: string, args: Record<string, unknown>) {
        this.calls.push({ tool, args });
        return this.responder(tool, args, this.calls.length - 1);
    }
}

function createSpanRecorder() {
    const spans: Array<{
        name: string;
        attributes: Record<string, unknown>;
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
                };
                spans.push(span);
                return operation({
                    setAttributes(nextAttributes) {
                        Object.assign(span.attributes, nextAttributes);
                    },
                    addEvent(_eventName, _eventAttributes) {
                        return undefined;
                    },
                });
            },
        },
    };
}

test("loadSnapshot reads production data through official find primitives", async () => {
    const client = new RecordingMcpClient((_tool, args) => {
        switch (args.collection) {
            case "patients":
                return findResult([
                    {
                        patientId: "P-1",
                        triageLevel: "urgent",
                        status: "waiting",
                        arrivalTime: new Date("2026-06-09T12:00:00.000Z"),
                    },
                ]);
            case "beds":
                return findResult([
                    {
                        bedId: "B-1",
                        type: "exam",
                        status: "available",
                        needsCleaning: false,
                    },
                ]);
            case "staff":
                return findResult([
                    {
                        staffId: "S-1",
                        role: "nurse",
                        available: true,
                        currentAssignment: null,
                        shift: "day",
                    },
                ]);
            case "events":
                return findResult([]);
            default:
                throw new Error(
                    `Unexpected collection ${String(args.collection)}`,
                );
        }
    });
    const adapter = new MongoErMcpAdapter(client);

    const snapshot = await adapter.loadSnapshot();

    assert.equal(snapshot.patients[0]?.patientId, "P-1");
    assert.equal(snapshot.beds[0]?.bedId, "B-1");
    assert.equal(snapshot.staff[0]?.staffId, "S-1");
    assert.deepEqual(
        client.calls.map((call) => call.tool),
        ["find", "find", "find", "find"],
    );
});

test("bed lookup and assignment use find and conditional update-many", async () => {
    const client = new RecordingMcpClient((tool) => {
        if (tool === "find") {
            return findResult([
                {
                    bedId: "B-1",
                    room: "ER-101",
                    type: "exam",
                    status: "available",
                    needsCleaning: false,
                    hasMonitor: true,
                    version: 3,
                },
            ]);
        }
        return updateResult(1);
    });
    const adapter = new MongoErMcpAdapter(client);

    const beds = await adapter.getAvailableBeds({
        bedType: "exam",
        requiresMonitor: true,
        limit: 1,
    });
    const result = await adapter.assignPatientToBed({
        patientId: "P-1",
        bedId: beds[0]!.bedId,
        assignedByStaffId: "S-CHARGE",
        expectedBedVersion: beds[0]!.version,
    });

    assert.deepEqual(result, {
        status: "assigned",
        patientId: "P-1",
        bedId: "B-1",
    });
    assert.deepEqual(
        client.calls.map((call) => call.tool),
        ["find", "update-many", "update-many"],
    );
    assert.deepEqual(client.calls[1]?.args.filter, {
        bedId: "B-1",
        status: "available",
        needsCleaning: false,
        version: 3,
    });
});

test("patient intake creates missing patients through find and insert-many", async () => {
    const client = new RecordingMcpClient((tool) => {
        if (tool === "find") {
            return findResult([]);
        }
        if (tool === "insert-many") {
            return {
                structuredContent: { insertedCount: 1 },
                content: [{ type: "text", text: "Inserted 1 document(s)." }],
            };
        }
        throw new Error(`Unexpected tool ${tool}`);
    });
    const adapter = new MongoErMcpAdapter(client);

    const result = await adapter.upsertPatientIntake({
        patientId: "P-NEW",
        chiefComplaint: "Chest pain",
        status: "waiting",
        arrivalTime: "2026-06-09T12:00:00.000Z",
    });

    assert.deepEqual(result, {
        patientId: "P-NEW",
        status: "created",
    });
    assert.equal(client.calls[0]?.tool, "find");
    assert.equal(client.calls[0]?.args.collection, "patients");
    assert.deepEqual(client.calls[0]?.args.filter, { patientId: "P-NEW" });

    assert.equal(client.calls[1]?.tool, "insert-many");
    assert.equal(client.calls[1]?.args.collection, "patients");
});

test("patient intake updates existing patients through find and update-many", async () => {
    const client = new RecordingMcpClient((tool) => {
        if (tool === "find") {
            return findResult([
                {
                    patientId: "P-EXISTING",
                    status: "waiting",
                    arrivalTime: "2026-06-09T12:00:00.000Z",
                },
            ]);
        }
        if (tool === "update-many") {
            return updateResult(1);
        }
        throw new Error(`Unexpected tool ${tool}`);
    });
    const adapter = new MongoErMcpAdapter(client);

    const result = await adapter.upsertPatientIntake({
        patientId: "P-EXISTING",
        chiefComplaint: "Shortness of breath",
        status: "waiting",
        arrivalTime: "2026-06-09T12:30:00.000Z",
    });

    assert.deepEqual(result, {
        patientId: "P-EXISTING",
        status: "updated",
    });
    assert.deepEqual(
        client.calls.map((call) => call.tool),
        ["find", "update-many"],
    );
    assert.equal(client.calls[1]?.args.collection, "patients");
});

test("workflow repository emits sanitized tracing spans for production steps", async () => {
    const client = new RecordingMcpClient((tool, args) => {
        if (tool === "find" && args.collection === "patients") {
            return findResult([]);
        }
        if (tool === "find" && args.collection === "beds") {
            return findResult([
                {
                    bedId: "B-1",
                    room: "ER-101",
                    type: "trauma",
                    status: "available",
                    needsCleaning: false,
                    hasMonitor: true,
                    version: 2,
                },
            ]);
        }
        if (tool === "find" && args.collection === "staff") {
            return findResult([
                {
                    staffId: "S-1",
                    name: "Nurse Example",
                    role: "nurse",
                    available: true,
                    currentAssignment: null,
                    shift: "day",
                },
            ]);
        }
        if (tool === "insert-many" || tool === "update-many") {
            return updateResult(1);
        }
        throw new Error(`Unexpected tool ${tool}`);
    });
    const recorder = createSpanRecorder();
    setWorkflowSpanRunnerForTests(recorder.runner);

    try {
        const adapter = new MongoErMcpAdapter(client);
        await adapter.upsertPatientIntake({
            patientId: "PAT-SECRET",
            name: "Private Patient",
            chiefComplaint: "Do not trace",
            triageLevel: "critical",
        });
        await adapter.getAvailableBeds({
            bedType: "trauma",
            requiresMonitor: true,
            limit: 1,
        });
        await adapter.assignPatientToBed({
            patientId: "PAT-SECRET",
            bedId: "B-1",
            assignedByStaffId: "S-CHARGE",
            expectedBedVersion: 2,
        });
        await adapter.getAvailableStaff({
            roles: ["nurse"],
            shift: "day",
            limit: 1,
        });
        await adapter.assignStaffToPatient({
            patientId: "PAT-SECRET",
            staffIds: ["S-1"],
        });
    } finally {
        setWorkflowSpanRunnerForTests(undefined);
    }

    assert.deepEqual(
        recorder.spans.map((span) => span.name),
        [
            workflowSpanNames.patientIntake,
            workflowSpanNames.bedLookup,
            workflowSpanNames.bedAssignment,
            workflowSpanNames.staffLookup,
            workflowSpanNames.staffAssignment,
        ],
    );
    assert.equal(
        typeof recorder.spans[0]?.attributes["rapid_handoff.patient_ref"],
        "string",
    );
    assert.equal(
        "rapid_handoff.name" in (recorder.spans[0]?.attributes ?? {}),
        false,
    );
    assert.equal(
        "rapid_handoff.chiefComplaint" in (recorder.spans[0]?.attributes ?? {}),
        false,
    );
});
