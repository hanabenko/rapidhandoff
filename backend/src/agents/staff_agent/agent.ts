import { FunctionTool, LlmAgent } from "@google/adk";
import { z } from "zod";

import { getAvailableStaffTool } from "../orchestrator_agent/actions.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export const confirmStaffAssignmentTool = new FunctionTool({
    name: "confirm_staff_assignment",
    description:
        "REQUIRED final action. Call this to commit the staffing recommendation. " +
        "Your turn is not complete until you call this tool. " +
        "This is a read-only recommendation — the orchestrator will execute the actual DB assignments.",
    parameters: z.object({
        recommendedStaff: z
            .array(
                z.object({
                    staffId: z.string(),
                    name: z.string(),
                    role: z.string(),
                }),
            )
            .describe("Staff members selected from query results — do NOT invent these"),
        coverageLevel: z
            .enum(["full", "partial", "none"])
            .describe(
                "full = all required roles found; partial = some missing; none = no staff found",
            ),
        rolesNeeded: z
            .array(z.string())
            .describe("Roles required for this patient's ESI level"),
        rolesMissing: z
            .array(z.string())
            .describe("Required roles with no available staff"),
        escalationNeeded: z
            .boolean()
            .describe(
                "True if ESI 1-2 patient has no available physician — charge nurse must escalate",
            ),
        summary: z.string().describe("One-sentence handoff note for the care team"),
    }),
    execute: async (result) => ({ status: "confirmed", ...result }),
});

export const staffAgent = new LlmAgent({
    name: "er_staff_coordinator",
    model,
    description:
        "Queries available ER staff and recommends assignments for a new patient based on ESI level. " +
        "Returns a structured recommendation — the orchestrator executes the actual assignments.",
    instruction: `You are the staff coordination agent for the Rapid Handoff emergency department.

Your job: find available staff that match a patient's ESI triage level, then call confirm_staff_assignment.

## CRITICAL: You MUST call confirm_staff_assignment

Your turn is not complete until you call confirm_staff_assignment.
Do NOT respond with text only. Do NOT skip confirm_staff_assignment for any reason.
Even if get_available_staff returns an error or no results, still call confirm_staff_assignment.

## Role Requirements by ESI Level

| ESI | Required Roles |
|-----|----------------|
| 1 (Critical) | physician + nurse (both required) |
| 2 (Emergent) | physician + nurse (both required) |
| 3 (Urgent) | nurse (required); add physician if available |
| 4 (Less Urgent) | nurse or tech (one sufficient) |
| 5 (Non-Urgent) | tech |

## Steps

1. Identify required roles from the ESI level.
2. Call get_available_staff with those roles.
3. From the results, pick one staff member per required role.
4. Call confirm_staff_assignment with your recommendation.
   - recommendedStaff: staff you selected (use real IDs/names from query results only)
   - coverageLevel: "full" if all roles found, "partial" if some missing, "none" if empty
   - rolesNeeded: roles you requested
   - rolesMissing: roles you could not fill
   - escalationNeeded: true only if ESI 1-2 and no physician was available
   - summary: one-sentence handoff note

## Rules

- Use only staffIds and names from get_available_staff results. Never invent them.
- If get_available_staff returns an error or empty list, set recommendedStaff: [], coverageLevel: "none".
- confirm_staff_assignment is a recommendation only — you are not writing to the database.`,
    tools: [getAvailableStaffTool, confirmStaffAssignmentTool],
});
