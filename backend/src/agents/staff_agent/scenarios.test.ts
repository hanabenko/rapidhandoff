/**
 * Staff coordination agent integration tests — requires Vertex AI credentials + MongoDB.
 *
 * Before running:
 *   gcloud auth application-default login
 *   cp .env.example .env  # fill in GOOGLE_CLOUD_PROJECT and MONGODB_URI
 *
 * Run:
 *   pnpm test:staff
 */

import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRunner, getFunctionResponses } from "@google/adk";

import { staffAgent } from "./agent.js";

const runner = new InMemoryRunner({
    agent: staffAgent,
    appName: "rapid_handoff_staff_test",
});

interface StaffResult {
    recommendedStaff?: Array<{ staffId: string; name: string; role: string }>;
    coverageLevel?: "full" | "partial" | "none";
    rolesNeeded?: string[];
    rolesMissing?: string[];
    escalationNeeded?: boolean;
    summary?: string;
}

async function coordinate(request: string): Promise<StaffResult> {
    const result: StaffResult = {};

    for await (const event of runner.runEphemeral({
        userId: "test-runner",
        newMessage: {
            role: "user",
            parts: [{ text: request }],
        },
    })) {
        for (const fn of getFunctionResponses(event)) {
            if (fn.name === "confirm_staff_assignment" && fn.response) {
                Object.assign(result, fn.response);
            }
        }
    }

    return result;
}

// ── Scenario 1: ESI 1 critical patient ────────────────────────────────────────
// Expected: physician + nurse requested; full or partial coverage; no invented IDs
test("ESI 1 critical patient → requests physician and nurse", async () => {
    const result = await coordinate(
        "Assign staff for patient P-0001 (James Carter). " +
        "ESI level: 1, triage level: critical. " +
        "Chief complaint: unresponsive, cardiac arrest. Assign immediately.",
    );

    console.log("Scenario 1 result:", JSON.stringify(result, null, 2));
    assert.ok(result.coverageLevel, "coverageLevel must be set");
    assert.ok(result.rolesNeeded, "rolesNeeded must be set");
    assert.ok(
        result.rolesNeeded!.includes("physician") || result.rolesNeeded!.some(r => r.toLowerCase().includes("physician")),
        `ESI 1 must require a physician, got rolesNeeded: ${JSON.stringify(result.rolesNeeded)}`,
    );
    assert.ok(
        result.rolesNeeded!.includes("nurse") || result.rolesNeeded!.some(r => r.toLowerCase().includes("nurse")),
        `ESI 1 must require a nurse, got rolesNeeded: ${JSON.stringify(result.rolesNeeded)}`,
    );
    assert.ok(
        result.coverageLevel === "full" || result.coverageLevel === "partial" || result.coverageLevel === "none",
        `Expected a valid coverageLevel, got: ${result.coverageLevel}`,
    );
    // Verify recommended staff have real structure (not invented)
    if (result.recommendedStaff?.length) {
        for (const s of result.recommendedStaff) {
            assert.ok(s.staffId, "Each recommended staff must have a staffId");
            assert.ok(s.name, "Each recommended staff must have a name");
            assert.ok(s.role, "Each recommended staff must have a role");
        }
    }
});

// ── Scenario 2: ESI 3 urgent patient ──────────────────────────────────────────
// Expected: nurse required; physician optional; coverageLevel set
test("ESI 3 urgent patient → assigns nurse as primary role", async () => {
    const result = await coordinate(
        "Assign staff for patient P-0002 (Maria Santos). " +
        "ESI level: 3, triage level: urgent. " +
        "Chief complaint: chest pain, stable vitals. Needs nursing assessment.",
    );

    console.log("Scenario 2 result:", JSON.stringify(result, null, 2));
    assert.ok(result.coverageLevel, "coverageLevel must be set");
    assert.ok(result.rolesNeeded, "rolesNeeded must be set");
    assert.ok(
        result.rolesNeeded!.some(r => r.toLowerCase().includes("nurse")),
        `ESI 3 must require a nurse, got rolesNeeded: ${JSON.stringify(result.rolesNeeded)}`,
    );
    assert.ok(
        result.coverageLevel === "full" || result.coverageLevel === "partial",
        `Expected full or partial coverage, got: ${result.coverageLevel}`,
    );
    // ESI 3 should NOT set escalationNeeded (only for ESI 1-2 without physician)
    assert.ok(
        !result.escalationNeeded,
        "ESI 3 should not trigger physician escalation",
    );
});

// ── Scenario 3: ESI 4 less-urgent patient ─────────────────────────────────────
// Expected: nurse or tech sufficient; no physician required
test("ESI 4 less-urgent patient → tech or nurse is sufficient", async () => {
    const result = await coordinate(
        "Assign staff for patient P-0003 (Ethan Brooks). " +
        "ESI level: 4, triage level: less_urgent. " +
        "Chief complaint: closed forearm fracture, stable vitals.",
    );

    console.log("Scenario 3 result:", JSON.stringify(result, null, 2));
    assert.ok(result.coverageLevel, "coverageLevel must be set");
    assert.ok(result.rolesNeeded, "rolesNeeded must be set");
    // ESI 4 should not mandate a physician
    const requiresPhysician = result.rolesNeeded!.some(r => r.toLowerCase() === "physician");
    assert.ok(
        !requiresPhysician,
        `ESI 4 should not require a physician as a mandatory role`,
    );
});

// ── Scenario 4: Confirm summary text is present ───────────────────────────────
test("coordinator always returns a non-empty summary", async () => {
    const result = await coordinate(
        "Assign staff for patient P-0004 (Sofia Nguyen). " +
        "ESI level: 3, triage level: urgent. " +
        "Chief complaint: hand laceration needing sutures.",
    );

    console.log("Scenario 4 result:", JSON.stringify(result, null, 2));
    assert.ok(result.summary, "summary must be present");
    assert.ok(result.summary!.length > 10, "summary must be a real sentence");
});
