import assert from "node:assert/strict";
import test from "node:test";
import { BSON } from "mongodb";

import {
    MongoErMcpAdapter,
    type MongoMcpToolClient,
} from "./mongodb.js";

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

    constructor(
        private readonly respond: (
            tool: string,
            args: Record<string, unknown>,
            callIndex: number,
        ) => unknown,
    ) {}

    async callTool(tool: string, args: Record<string, unknown>) {
        this.calls.push({ tool, args });
        return this.respond(tool, args, this.calls.length - 1);
    }
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
                throw new Error(`Unexpected collection ${String(args.collection)}`);
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

test("patient intake upserts through update-many", async () => {
    const client = new RecordingMcpClient(() => updateResult(0, 0, 1));
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
    assert.equal(client.calls[0]?.tool, "update-many");
    assert.equal(client.calls[0]?.args.collection, "patients");
    assert.equal(client.calls[0]?.args.upsert, true);
});

test("staff assignment rolls back earlier reservations when one fails", async () => {
    const client = new RecordingMcpClient((_tool, _args, index) => {
        if (index === 0) {
            return updateResult(1);
        }
        if (index === 1) {
            return updateResult(0, 0);
        }
        return updateResult(1);
    });
    const adapter = new MongoErMcpAdapter(client);

    await assert.rejects(
        adapter.assignStaffToPatient({
            patientId: "P-1",
            staffIds: ["S-1", "S-2"],
        }),
        /S-2 is no longer available/,
    );

    assert.deepEqual(
        client.calls.map((call) => call.tool),
        ["update-many", "update-many", "update-many"],
    );
    assert.deepEqual(client.calls[2]?.args.filter, {
        staffId: "S-1",
        currentAssignment: "P-1",
    });
});
