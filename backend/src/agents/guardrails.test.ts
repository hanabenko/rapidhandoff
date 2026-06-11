import assert from "node:assert/strict";
import test from "node:test";

import { applyTriageGuardrails } from "./triage_agent/guardrails.js";
import { applyBedGuardrails } from "./bed_management_agent/guardrails.js";
import { applyStaffGuardrails } from "./staff_coordination_agent/guardrails.js";
import { applyReportingGuardrails } from "./reporting_agent/guardrails.js";

test("triage guardrail escalates unstable vitals using ESI-style rules", () => {
    const result = applyTriageGuardrails(
        {
            patientId: "P-ESI-1",
            symptoms: [],
            vitals: { oxygenSat: 84 },
        },
        {
            patientId: "P-ESI-1",
            severity: "low",
            urgency: "standard",
            routingPriority: "fast_track",
            recommendedBedType: "exam",
            requiresMonitor: false,
            rationale: "Model proposal.",
            appliedRules: [],
        },
    );

    assert.equal(result.esiLevel, 1);
    assert.equal(result.routingPriority, "resuscitation");
    assert.equal(result.recommendedBedType, "trauma");
    assert.ok(result.appliedRules.includes("unstable_vitals_escalation"));
});

test("bed guardrail selects only monitor-capable eligible beds", () => {
    const result = applyBedGuardrails(
        {
            patientId: "P-BED-1",
            severity: "high",
            urgency: "expedited",
            routingPriority: "monitored_bed",
            recommendedBedType: "exam",
            requiresMonitor: true,
            candidateBeds: [
                { bedId: "B-1", type: "exam", hasMonitor: false },
                { bedId: "B-2", type: "exam", hasMonitor: true },
            ],
        },
        {
            patientId: "P-BED-1",
            assignmentStatus: "assigned",
            selectedBedId: "B-1",
            selectedBedType: "exam",
            rationale: "Model proposal.",
            estimatedWaitMinutes: 0,
            appliedRules: [],
        },
    );

    assert.equal(result.selectedBedId, "B-2");
    assert.ok(result.appliedRules.includes("monitor_required"));
});

test("staff guardrail enforces availability and high-acuity role coverage", () => {
    const result = applyStaffGuardrails(
        {
            patientId: "P-STAFF-1",
            severity: "high",
            urgency: "expedited",
            routingPriority: "monitored_bed",
            assignedBedId: "B-2",
            candidateStaff: [
                {
                    staffId: "RN-BUSY",
                    role: "nurse",
                    shift: "day",
                    available: false,
                },
                {
                    staffId: "RN-1",
                    role: "nurse",
                    specialty: "emergency",
                    shift: "day",
                    available: true,
                },
                {
                    staffId: "DOC-1",
                    role: "physician",
                    specialty: "emergency",
                    shift: "day",
                    available: true,
                },
            ],
            preferredSpecialties: ["emergency"],
        },
        {
            patientId: "P-STAFF-1",
            assignmentStatus: "assigned",
            assignedStaffIds: ["RN-BUSY"],
            assignedRoles: ["nurse"],
            alertMessage: "Model proposal.",
            rationale: "Model proposal.",
            appliedRules: [],
        },
    );

    assert.deepEqual(result.assignedStaffIds.sort(), ["DOC-1", "RN-1"]);
    assert.deepEqual(result.assignedRoles.sort(), ["nurse", "physician"]);
});

test("reporting guardrail uses validated upstream state as source of truth", () => {
    const result = applyReportingGuardrails(
        {
            patientId: "P-REPORT-1",
            triage: {
                patientId: "P-REPORT-1",
                severity: "moderate",
                urgency: "standard",
                routingPriority: "standard_bed",
                recommendedBedType: "exam",
                requiresMonitor: false,
                rationale: "Validated.",
                appliedRules: [],
            },
            bedAssignment: {
                patientId: "P-REPORT-1",
                assignmentStatus: "waitlisted",
                selectedBedId: null,
                selectedBedType: "exam",
                rationale: "No capacity.",
                estimatedWaitMinutes: 30,
                appliedRules: [],
            },
            staffAssignment: {
                patientId: "P-REPORT-1",
                assignmentStatus: "deferred",
                assignedStaffIds: [],
                assignedRoles: [],
                alertMessage: "Deferred.",
                rationale: "No bed.",
                appliedRules: [],
            },
            censusSummary: {},
            bedCapacitySummary: {},
            staffingSummary: {},
        },
        {
            patientId: "wrong",
            operationalSummary: "Model summary.",
            dashboardStatus: {
                patientId: "wrong",
                triageSeverity: "low",
                routingPriority: "fast_track",
                bedId: "INVENTED",
                assignedStaffIds: ["INVENTED"],
                estimatedWaitMinutes: 0,
            },
            criticalAlerts: [],
            appliedRules: [],
        },
    );

    assert.equal(result.dashboardStatus.patientId, "P-REPORT-1");
    assert.equal(result.dashboardStatus.bedId, null);
    assert.deepEqual(result.dashboardStatus.assignedStaffIds, []);
    assert.equal(result.criticalAlerts.length, 2);
});
