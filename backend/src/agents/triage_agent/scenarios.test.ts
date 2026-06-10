/**
 * Triage agent integration tests — requires Vertex AI credentials.
 *
 * Before running:
 *   gcloud auth application-default login
 *   export GOOGLE_GENAI_USE_VERTEXAI=TRUE
 *   export GOOGLE_CLOUD_PROJECT=<your-project>
 *   export MONGODB_URI=<your-uri>   (only needed for the full orchestrator tests)
 *
 * Run:
 *   GOOGLE_GENAI_USE_VERTEXAI=TRUE tsx --test backend/src/agents/triage_agent/scenarios.test.ts
 */

import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import {
    InMemoryRunner,
    getFunctionResponses,
} from "@google/adk";

import { triageAgent } from "./agent.js";

const runner = new InMemoryRunner({
    agent: triageAgent,
    appName: "rapid_handoff_triage_test",
});

interface TriageResult {
    esiLevel?: number;
    triageLevel?: string;
    reasoning?: string;
    carePathway?: string;
    recommendedBedType?: string;
    requiresMonitor?: boolean;
    escalationFlags?: string[];
}

async function triage(patientDescription: string): Promise<TriageResult> {
    const result: TriageResult = {};

    for await (const event of runner.runEphemeral({
        userId: "test-runner",
        newMessage: {
            role: "user",
            parts: [{ text: patientDescription }],
        },
    })) {
        for (const fn of getFunctionResponses(event)) {
            if (fn.name === "record_triage_assessment" && fn.response) {
                Object.assign(result, fn.response);
            }
        }
    }

    return result;
}

// ── Scenario 1: Chest pain + hemodynamic instability ──────────────────────────
// Expected: ESI 2 (emergent) — classic high-risk cardiac presentation
test("chest pain with hypotension and tachycardia → ESI 2", async () => {
    const result = await triage(
        "Patient: Maria Santos, 58F. " +
        "Chief complaint: crushing chest pain radiating to left arm, started 20 minutes ago. " +
        "Vitals: HR 118 bpm, BP 88/54 mmHg, SpO2 92%, temp 98.4°F. " +
        "Diaphoretic, pale, reporting pain 9/10.",
    );

    console.log("Scenario 1 result:", JSON.stringify(result, null, 2));
    assert.ok(result.esiLevel, "ESI level should be set");
    assert.ok(
        result.esiLevel! <= 2,
        `Expected ESI 1 or 2 for unstable chest pain, got ESI ${result.esiLevel}`,
    );
    assert.ok(
        result.requiresMonitor,
        "Cardiac monitor required for this presentation",
    );
    assert.ok(
        result.recommendedBedType === "trauma" || result.recommendedBedType === "exam",
        `Unexpected bed type: ${result.recommendedBedType}`,
    );
});

// ── Scenario 2: Isolated closed fracture ──────────────────────────────────────
// Expected: ESI 4 (less urgent) — one resource needed, stable vitals
test("isolated closed arm fracture with normal vitals → ESI 3 or 4", async () => {
    const result = await triage(
        "Patient: Ethan Brooks, 22M. " +
        "Chief complaint: fell off skateboard, right forearm pain and visible deformity. " +
        "Vitals: HR 82 bpm, BP 124/78 mmHg, SpO2 99%, temp 98.6°F. " +
        "Alert and oriented, pain 5/10, neurovascularly intact distally.",
    );

    console.log("Scenario 2 result:", JSON.stringify(result, null, 2));
    assert.ok(result.esiLevel, "ESI level should be set");
    assert.ok(
        result.esiLevel! >= 3 && result.esiLevel! <= 4,
        `Expected ESI 3 or 4 for closed fracture, got ESI ${result.esiLevel}`,
    );
});

// ── Scenario 3: Pediatric fever ───────────────────────────────────────────────
// Expected: ESI 2 or 3 — high fever in a child, potential febrile seizure risk
test("pediatric high fever with tachycardia → ESI 2 or 3", async () => {
    const result = await triage(
        "Patient: Lily Chen, 6F. " +
        "Chief complaint: mother reports 2-day high fever, child is lethargic and not eating. " +
        "Vitals: HR 148 bpm, BP 90/60 mmHg, SpO2 96%, temp 104.3°F. " +
        "Appears ill, difficult to arouse, no rash visible.",
    );

    console.log("Scenario 3 result:", JSON.stringify(result, null, 2));
    assert.ok(result.esiLevel, "ESI level should be set");
    assert.ok(
        result.esiLevel! <= 3,
        `Expected ESI 1–3 for lethargic child with 104°F fever, got ESI ${result.esiLevel}`,
    );
    assert.ok(
        result.recommendedBedType === "pediatric" || result.recommendedBedType === "trauma" || result.recommendedBedType === "exam",
        `Unexpected bed type for pediatric: ${result.recommendedBedType}`,
    );
});

// ── Scenario 4: Unresponsive adult ────────────────────────────────────────────
// Expected: ESI 1 (critical) — immediate life-saving intervention required
test("unresponsive adult with critical vitals → ESI 1", async () => {
    const result = await triage(
        "Patient: James Carter, 67M, brought in by EMS. " +
        "Chief complaint: found unresponsive at home, unknown downtime. " +
        "Vitals: HR 38 bpm, BP 72/40 mmHg, SpO2 78%, temp 95.1°F. " +
        "GCS 3, no response to verbal or painful stimuli, agonal respirations.",
    );

    console.log("Scenario 4 result:", JSON.stringify(result, null, 2));
    assert.ok(result.esiLevel, "ESI level should be set");
    assert.equal(
        result.esiLevel,
        1,
        `Expected ESI 1 for unresponsive patient with critical vitals, got ESI ${result.esiLevel}`,
    );
    assert.equal(result.recommendedBedType, "trauma", "Must use trauma bed");
    assert.ok(result.requiresMonitor, "Cardiac monitor required");
});

// ── Scenario 5: Hand laceration ───────────────────────────────────────────────
// Expected: ESI 3 — needs sutures (one procedure), stable vitals
test("deep hand laceration needing sutures → ESI 3 or 4", async () => {
    const result = await triage(
        "Patient: Sofia Nguyen, 34F. " +
        "Chief complaint: cut right hand on broken glass while cooking, 20 minutes ago. " +
        "Vitals: HR 88 bpm, BP 118/74 mmHg, SpO2 100%, temp 98.7°F. " +
        "4cm laceration across palm, bleeding controlled with direct pressure, " +
        "full finger movement intact, pain 4/10.",
    );

    console.log("Scenario 5 result:", JSON.stringify(result, null, 2));
    assert.ok(result.esiLevel, "ESI level should be set");
    assert.ok(
        result.esiLevel! >= 3 && result.esiLevel! <= 4,
        `Expected ESI 3 or 4 for laceration needing sutures, got ESI ${result.esiLevel}`,
    );
});
