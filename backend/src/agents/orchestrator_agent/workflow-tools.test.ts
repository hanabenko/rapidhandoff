import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AgentTool } from "@google/adk";

import { rootAgent, rootSynthesisAgent } from "./agent.js";
import { triageAgent } from "../triage_agent/agent.js";
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

test("root orchestrator exposes delegated sub-agent tools", async () => {
    const toolNames = (await rootAgent.canonicalTools()).map((tool) => tool.name);

    for (const name of [
        "triage_agent",
        "bed_management_agent",
        "staff_coordination_agent",
        "reporting_agent",
    ]) {
        assert.ok(toolNames.includes(name), `${name} is missing from root agent`);
    }

    assert.equal(
        rootAgent.tools.every((tool) => tool instanceof AgentTool),
        true,
    );
});

test("delegated agent schemas avoid Vertex-unsupported exclusiveMinimum", async () => {
    const tools = await rootAgent.canonicalTools();
    const declarations = tools.map((tool) =>
        (
            tool as unknown as {
                _getDeclaration(): Record<string, unknown>;
            }
        )._getDeclaration(),
    );

    assert.doesNotMatch(JSON.stringify(declarations), /exclusiveMinimum/);
});

test("root synthesis agent does not resend delegated tool schemas", async () => {
    assert.deepEqual(await rootSynthesisAgent.canonicalTools(), []);
});

test("triage response schema uses a Vertex-compatible bounded ESI integer", () => {
    const serialized = JSON.stringify(triageAgent.outputSchema);

    assert.doesNotMatch(serialized, /"anyOf"/);
    assert.match(serialized, /"minimum":1/);
    assert.match(serialized, /"maximum":5/);
});
