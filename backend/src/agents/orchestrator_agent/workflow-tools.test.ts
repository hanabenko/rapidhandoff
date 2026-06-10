import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { rootAgent } from "./agent.js";
import { loadErSnapshot, type MongoErRepository } from "./data.js";
import { createMongoWorkflowTools } from "./workflow-tools.js";

function repositoryStub(): MongoErRepository {
    return {
        async loadSnapshot() {
            return {
                capturedAt: new Date("2026-06-09T12:00:00.000Z"),
                patients: [],
                beds: [],
                staff: [],
                events: [],
            };
        },
        async upsertPatientIntake(input) {
            return { status: "updated", patientId: input.patientId };
        },
        async getAvailableBeds() {
            return [];
        },
        async assignPatientToBed(input) {
            return { status: "assigned", bedId: input.bedId };
        },
        async getAvailableStaff() {
            return [];
        },
        async assignStaffToPatient(input) {
            return { status: "assigned", staffIds: input.staffIds };
        },
        async updateSupplyInventory() {
            return { status: "updated" };
        },
        async close() {},
    };
}

test("production snapshot loading delegates to the MongoDB MCP repository", async () => {
    let called = false;
    const repository = repositoryStub();
    const snapshot = await loadErSnapshot({
        async loadSnapshot() {
            called = true;
            return repository.loadSnapshot();
        },
    });

    assert.equal(called, true);
    assert.equal(snapshot.patients.length, 0);

    const source = readFileSync(resolve("backend/src/agents/orchestrator_agent/data.ts"), "utf8");
    assert.doesNotMatch(source, /MongoClient/);
});

test("workflow ADK tools invoke the injected MCP-backed repository", async () => {
    const calls: string[] = [];
    const repository = repositoryStub();
    repository.upsertPatientIntake = async (input) => {
        calls.push(`intake:${input.patientId}`);
        return { status: "updated" };
    };
    const tools = createMongoWorkflowTools(() => repository);
    const intakeTool = tools.find((tool) => tool.name === "upsert_patient_intake");

    assert.ok(intakeTool);
    await intakeTool.runAsync({
        args: {
            patientId: "P-1",
            chiefComplaint: "Chest pain",
        },
        toolContext: undefined as never,
    });

    assert.deepEqual(calls, ["intake:P-1"]);
});

test("root orchestrator exposes the MongoDB MCP workflow tools", async () => {
    const toolNames = (await rootAgent.canonicalTools()).map((tool) => tool.name);

    for (const name of [
        "upsert_patient_intake",
        "get_available_beds",
        "assign_patient_to_bed",
        "get_available_staff",
        "assign_staff_to_patient",
    ]) {
        assert.ok(toolNames.includes(name), `${name} is missing from root agent`);
    }
});
