import assert from "node:assert/strict";
import test from "node:test";

import { getOperationsStatus } from "./operations.js";

test("operations status returns an MCP-backed active queue, beds, and staff", async () => {
    const result = await getOperationsStatus({
        async loadSnapshot() {
            return {
                capturedAt: new Date("2026-06-10T12:00:00.000Z"),
                patients: [
                    {
                        patientId: "DEMO-JB-1",
                        triageLevel: "urgent" as const,
                        status: "in_treatment" as const,
                        arrivalTime: new Date("2026-06-10T11:55:00.000Z"),
                        assignedBedId: "B-1",
                        assignedStaffIds: ["S-1"],
                    },
                    {
                        patientId: "DEMO-DONE-1",
                        status: "discharged" as const,
                        arrivalTime: new Date("2026-06-10T10:00:00.000Z"),
                    },
                ],
                beds: [
                    {
                        bedId: "B-1",
                        room: "ER-1",
                        type: "exam",
                        status: "available" as const,
                        needsCleaning: false,
                        hasMonitor: true,
                    },
                ],
                staff: [
                    {
                        staffId: "S-1",
                        name: "Demo Nurse",
                        role: "nurse" as const,
                        available: true,
                        currentAssignment: null,
                        shift: "day" as const,
                    },
                ],
                events: [],
            };
        },
    });

    assert.equal(result.capturedAt, "2026-06-10T12:00:00.000Z");
    assert.deepEqual(result.activeQueue, [
        {
            patientId: "DEMO-JB-1",
            triageLevel: "urgent",
            status: "in_treatment",
            arrivalTime: "2026-06-10T11:55:00.000Z",
            assignedBedId: "B-1",
            assignedStaffIds: ["S-1"],
        },
    ]);
    assert.equal(result.beds[0]?.bedId, "B-1");
    assert.equal(result.staff[0]?.staffId, "S-1");
});
