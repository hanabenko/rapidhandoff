import assert from "node:assert/strict";
import test from "node:test";

import {
    type ErSnapshot,
    buildBedCapacityAnalysis,
    buildBottleneckAnalysis,
    buildCensusSummary,
    buildStaffingRecommendation,
} from "./analytics.js";

const now = new Date("2026-06-07T18:00:00.000Z");

const snapshot: ErSnapshot = {
    capturedAt: now,
    patients: [
        {
            patientId: "P-1",
            triageLevel: "critical",
            status: "waiting",
            arrivalTime: new Date("2026-06-07T15:00:00.000Z"),
        },
        {
            patientId: "P-2",
            triageLevel: "urgent",
            status: "in_treatment",
            arrivalTime: new Date("2026-06-07T17:00:00.000Z"),
        },
        {
            patientId: "P-3",
            triageLevel: "less_urgent",
            status: "admitted",
            arrivalTime: new Date("2026-06-07T14:00:00.000Z"),
        },
        {
            patientId: "P-4",
            triageLevel: "non_urgent",
            status: "discharged",
            arrivalTime: new Date("2026-06-07T13:00:00.000Z"),
        },
    ],
    beds: [
        {
            bedId: "B-1",
            type: "trauma",
            status: "occupied",
            needsCleaning: false,
        },
        {
            bedId: "B-2",
            type: "exam",
            status: "available",
            needsCleaning: true,
        },
        {
            bedId: "B-3",
            type: "exam",
            status: "available",
            needsCleaning: false,
        },
    ],
    staff: [
        {
            staffId: "S-1",
            role: "physician",
            available: true,
            currentAssignment: null,
            shift: "day",
        },
        {
            staffId: "S-2",
            role: "nurse",
            available: true,
            currentAssignment: null,
            shift: "day",
        },
    ],
    events: [],
};

test("buildCensusSummary counts active patients and long waits", () => {
    const result = buildCensusSummary(snapshot, 120);

    assert.equal(result.activePatients, 3);
    assert.equal(result.waiting.count, 1);
    assert.equal(result.waiting.longestWaitMinutes, 180);
    assert.equal(result.waiting.overThreshold, 1);
    assert.equal(result.highAcuityActive, 1);
});

test("buildBedCapacityAnalysis excludes cleaning beds from ready capacity", () => {
    const result = buildBedCapacityAnalysis(snapshot);

    assert.equal(result.occupiedBeds, 1);
    assert.equal(result.readyBeds, 1);
    assert.equal(result.bedsAwaitingCleaning, 1);
    assert.equal(result.occupancyPercent, 33);
});

test("buildBottleneckAnalysis identifies queue, turnover, and boarding issues", () => {
    const result = buildBottleneckAnalysis(snapshot, 120);
    const areas = result.bottlenecks.map((item) => item.area);

    assert.ok(areas.includes("waiting_room"));
    assert.ok(areas.includes("bed_turnover"));
    assert.ok(areas.includes("admission_boarding"));
});

test("buildStaffingRecommendation reports planning targets", () => {
    const result = buildStaffingRecommendation(snapshot, "day");

    assert.equal(result.planningTargets.nurseEquivalent, 1);
    assert.equal(result.planningTargets.physician, 1);
    assert.equal(result.shift, "day");
});
