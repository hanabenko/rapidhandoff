import assert from "node:assert/strict";
import "dotenv/config";

import { BSON } from "mongodb";

import { RemoteMcpClient } from "../mcp/client.js";
import { getMongoMcpConfig } from "../mcp/config.js";
import { MongoErMcpAdapter, type MongoMcpToolClient } from "../mcp/mongodb.js";

interface SmokeIds {
    runId: string;
    reusedRunId: boolean;
    patientId: string;
    bedId: string;
    nurseId: string;
    physicianId: string;
}

interface SmokeDocument extends Record<string, unknown> {
    smokeTestRunId: string;
}

function requireMongoUri(): string {
    const value = process.env.MONGODB_URI?.trim();
    if (!value || value.startsWith("<")) {
        throw new Error(
            "MONGODB_URI is required. Set it in .env before running pnpm smoke:mcp.",
        );
    }
    return value;
}

function smokeIds(): SmokeIds {
    const configured = process.env.MCP_SMOKE_RUN_ID?.trim();
    const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runId = (configured || generated).replace(/[^a-zA-Z0-9-]/g, "-");
    const prefix = `SMOKE-MCP-${runId}`;

    return {
        runId,
        reusedRunId: Boolean(configured),
        patientId: `${prefix}-PATIENT`,
        bedId: `${prefix}-BED`,
        nurseId: `${prefix}-NURSE`,
        physicianId: `${prefix}-PHYSICIAN`,
    };
}

function timeout<T>(
    promise: Promise<T>,
    milliseconds: number,
    label: string,
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new Error(
                        `${label} timed out after ${milliseconds}ms. Check MongoDB network access, credentials, and MCP server logs.`,
                    ),
                ),
            milliseconds,
        );
    });

    return Promise.race([promise, deadline]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

class TimedSmokeMcpClient implements MongoMcpToolClient {
    constructor(
        private readonly client: RemoteMcpClient,
        private readonly timeoutMs: number,
    ) {}

    async callTool(toolName: string, args: Record<string, unknown>) {
        const collection =
            typeof args.collection === "string" ? ` ${args.collection}` : "";
        const label = `${toolName}${collection}`;
        process.stderr.write(`[smoke:mcp] ${label}\n`);
        const result = await timeout(
            this.client.callTool(toolName, args),
            this.timeoutMs,
            label,
        );
        process.stderr.write(`[smoke:mcp] ${label} ok\n`);
        return result;
    }

    close(): Promise<void> {
        return timeout(this.client.close(), 5_000, "MCP shutdown");
    }
}

function textContent(result: unknown): string[] {
    if (!result || typeof result !== "object") {
        return [];
    }
    const record = result as Record<string, unknown>;
    if (record.isError === true) {
        const message = Array.isArray(record.content)
            ? record.content
                  .flatMap((item) =>
                      item &&
                      typeof item === "object" &&
                      typeof (item as Record<string, unknown>).text === "string"
                          ? [(item as Record<string, unknown>).text as string]
                          : [],
                  )
                  .join(" ")
            : "MongoDB MCP tool call failed.";
        throw new Error(message);
    }
    if (!Array.isArray(record.content)) {
        return [];
    }
    return record.content.flatMap((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).text === "string"
            ? [(item as Record<string, unknown>).text as string]
            : [],
    );
}

function extractJsonPayload(text: string): string | null {
    const match = text.match(
        /<untrusted-user-data-([a-f0-9-]+)>\s*([\s\S]*?)\s*<\/untrusted-user-data-\1>/,
    );

    return match?.[2]?.trim() ?? null;
}

function jsonCandidates(text: string): string[] {
    const candidates = [text.trim()];

    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
        candidates.unshift(text.slice(arrayStart, arrayEnd + 1).trim());
    }

    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
        candidates.push(text.slice(objectStart, objectEnd + 1).trim());
    }

    return candidates;
}

function findDocuments(result: unknown): Record<string, unknown>[] {
    for (const text of textContent(result)) {
        for (const candidate of jsonCandidates(text)) {
            try {
                const parsed = BSON.EJSON.parse(candidate, { relaxed: true });

                if (Array.isArray(parsed)) {
                    return parsed.filter(
                        (item): item is Record<string, unknown> =>
                            Boolean(item && typeof item === "object"),
                    );
                }

                if (parsed && typeof parsed === "object") {
                    return [parsed as Record<string, unknown>];
                }
            } catch {
                // Try the next candidate.
            }
        }
    }

    return [];
}

function structuredCount(result: unknown, name: string): number {
    if (!result || typeof result !== "object") {
        return 0;
    }
    const structured = (result as Record<string, unknown>).structuredContent;
    if (!structured || typeof structured !== "object") {
        return 0;
    }
    const value = (structured as Record<string, unknown>)[name];
    return typeof value === "number" ? value : 0;
}

async function findOne(
    client: MongoMcpToolClient,
    database: string,
    collection: string,
    filter: Record<string, unknown>,
) {
    const documents = findDocuments(
        await client.callTool("find", {
            database,
            collection,
            filter,
            limit: 2,
        }),
    );
    assert.equal(
        documents.length,
        1,
        `Expected one ${collection} record matching ${JSON.stringify(filter)}.`,
    );
    return documents[0]!;
}

async function removeSmokeData(
    client: MongoMcpToolClient,
    database: string,
    runId: string,
) {
    for (const collection of ["patients", "beds", "staff"]) {
        await client.callTool("delete-many", {
            database,
            collection,
            filter: { smokeTestRunId: runId },
        });
    }
}

async function seedSmokeData(
    client: MongoMcpToolClient,
    database: string,
    ids: SmokeIds,
) {
    const now = new Date();
    const bed: SmokeDocument = {
        smokeTestRunId: ids.runId,
        bedId: ids.bedId,
        room: `SMOKE-${ids.runId}`,
        type: "exam",
        status: "available",
        occupiedByPatientId: null,
        needsCleaning: false,
        hasMonitor: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };
    const staff: SmokeDocument[] = [
        {
            smokeTestRunId: ids.runId,
            staffId: ids.nurseId,
            name: "MCP Smoke Nurse",
            role: "nurse",
            department: "Emergency Test",
            available: true,
            currentAssignment: null,
            shift: "night",
            createdAt: now,
            updatedAt: now,
        },
        {
            smokeTestRunId: ids.runId,
            staffId: ids.physicianId,
            name: "MCP Smoke Physician",
            role: "physician",
            department: "Emergency Test",
            available: true,
            currentAssignment: null,
            shift: "night",
            createdAt: now,
            updatedAt: now,
        },
    ];

    const bedResult = await client.callTool("insert-many", {
        database,
        collection: "beds",
        documents: [bed],
    });
    const staffResult = await client.callTool("insert-many", {
        database,
        collection: "staff",
        documents: staff,
    });

    assert.equal(structuredCount(bedResult, "insertedCount"), 1);
    assert.equal(structuredCount(staffResult, "insertedCount"), 2);
}

async function run() {
    requireMongoUri();
    if (process.env.MDB_MCP_READ_ONLY?.toLowerCase() === "true") {
        throw new Error(
            "pnpm smoke:mcp requires MDB_MCP_READ_ONLY=false because it creates, updates, and removes test records.",
        );
    }

    const database =
        process.env.MCP_SMOKE_DATABASE?.trim() || "er_system_smoke";
    const keepData = process.env.MCP_SMOKE_KEEP_DATA?.toLowerCase() === "true";
    const timeoutMs = Number.parseInt(
        process.env.MCP_SMOKE_TIMEOUT_MS ?? "30000",
        10,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
        throw new Error("MCP_SMOKE_TIMEOUT_MS must be at least 1000.");
    }
    const ids = smokeIds();
    const env = {
        ...process.env,
        MDB_MCP_READ_ONLY: "false",
        MDB_MCP_CONFIRMATION_REQUIRED_TOOLS: "",
        MDB_MCP_TELEMETRY: "disabled",
        // Test databases may not have indexes yet. Production index policy is
        // unchanged; this override is scoped to the smoke subprocess.
        MDB_MCP_INDEX_CHECK:
            process.env.MCP_SMOKE_INDEX_CHECK?.trim() || "false",
    };
    const transportClient = new RemoteMcpClient(
        "mongodb-smoke",
        getMongoMcpConfig(env),
    );
    const client = new TimedSmokeMcpClient(transportClient, timeoutMs);
    const repository = new MongoErMcpAdapter(client, { database, env });

    let cleanupNeeded = false;
    process.stderr.write(
        `[smoke:mcp] run ${ids.runId} using database ${database}\n`,
    );
    try {
        if (ids.reusedRunId) {
            await removeSmokeData(client, database, ids.runId);
        }
        await seedSmokeData(client, database, ids);
        cleanupNeeded = true;

        const intakeRequest = {
            patientId: ids.patientId,
            name: "MCP Smoke Patient",
            age: 44,
            chiefComplaint: "MCP smoke test intake",
            symptoms: ["test-only symptom"],
            triageLevel: "urgent" as const,
            status: "waiting" as const,
            arrivalTime: new Date().toISOString(),
            smokeTestRunId: ids.runId,
        };
        const intake = await repository.upsertPatientIntake(intakeRequest);

        const beds = await repository.getAvailableBeds({
            bedType: "exam",
            requiresMonitor: true,
            limit: 100,
        });
        const bed = beds.find((candidate) => candidate.bedId === ids.bedId);
        assert.ok(
            bed,
            "The MCP-seeded smoke bed was not returned as available.",
        );

        const bedAssignment = await repository.assignPatientToBed({
            patientId: ids.patientId,
            bedId: ids.bedId,
            assignedByStaffId: ids.nurseId,
            expectedBedVersion: bed.version,
        });

        const staff = await repository.getAvailableStaff({
            roles: ["nurse", "physician"],
            shift: "night",
            limit: 100,
        });
        for (const staffId of [ids.nurseId, ids.physicianId]) {
            assert.ok(
                staff.some((member) => member.staffId === staffId),
                `The MCP-seeded staff member ${staffId} was not available.`,
            );
        }

        const staffAssignment = await repository.assignStaffToPatient({
            patientId: ids.patientId,
            staffIds: [ids.nurseId, ids.physicianId],
        });

        const patient = await findOne(client, database, "patients", {
            patientId: ids.patientId,
        });
        const assignedBed = await findOne(client, database, "beds", {
            bedId: ids.bedId,
        });
        const nurse = await findOne(client, database, "staff", {
            staffId: ids.nurseId,
        });
        const physician = await findOne(client, database, "staff", {
            staffId: ids.physicianId,
        });

        assert.equal(patient.status, "in_treatment");
        assert.equal(patient.assignedBedId, ids.bedId);
        assert.deepEqual(patient.assignedStaffIds, [
            ids.nurseId,
            ids.physicianId,
        ]);
        assert.equal(assignedBed.status, "occupied");
        assert.equal(assignedBed.occupiedByPatientId, ids.patientId);
        assert.equal(nurse.available, false);
        assert.equal(nurse.currentAssignment, ids.patientId);
        assert.equal(physician.available, false);
        assert.equal(physician.currentAssignment, ids.patientId);

        const response = {
            ok: true,
            database,
            runId: ids.runId,
            request: intakeRequest,
            intake,
            bedAssignment,
            staffAssignment,
            operationalState: {
                patientId: ids.patientId,
                status: patient.status,
                bedId: patient.assignedBedId,
                staffIds: patient.assignedStaffIds,
            },
            cleanup: keepData ? "retained" : "automatic",
        };
        process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    } finally {
        if (!keepData && cleanupNeeded) {
            try {
                await removeSmokeData(client, database, ids.runId);
            } catch (error) {
                console.error(
                    `[smoke:mcp] cleanup warning: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
        try {
            await repository.close();
        } catch (error) {
            console.error(
                `[smoke:mcp] shutdown warning: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}

run().then(
    () => process.exit(0),
    (error) => {
        console.error(
            error instanceof Error
                ? error.message
                : "MongoDB MCP smoke test failed.",
        );
        process.exit(1);
    },
);
