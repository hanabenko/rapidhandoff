import { z } from "zod";

import { bedTypeSchema, patientVitalsSchema } from "../../mcp/schemas.js";
import { bedManagementAgentOutputSchema } from "../bed_management_agent/contracts.js";
import { reportingAgentOutputSchema } from "../reporting_agent/contracts.js";
import { staffCoordinationAgentOutputSchema } from "../staff_coordination_agent/contracts.js";
import { triageAgentOutputSchema } from "../triage_agent/contracts.js";

export const workflowContextSchema = z.object({
    patientId: z.string().min(1),
    age: z.number().int().min(0).max(130).optional(),
    chiefComplaint: z.string().min(1).max(500).optional(),
    symptoms: z.array(z.string().min(1).max(200)).max(20).optional(),
    vitals: patientVitalsSchema.optional(),
    triageLevel: z
        .enum([
            "critical",
            "emergent",
            "urgent",
            "less_urgent",
            "non_urgent",
        ])
        .optional(),
    status: z
        .enum(["waiting", "in_treatment", "admitted", "discharged"])
        .optional(),
    arrivalTime: z.string().datetime().optional(),
    requestedBedType: bedTypeSchema.optional(),
    requiresMonitor: z.boolean().optional(),
    preferredShift: z.enum(["day", "evening", "night"]).optional(),
    assignedByStaffId: z.string().min(1).default("system-orchestrator"),
});

export const rootOrchestratorAgentInputSchema = z.object({
    query: z.string().min(1).max(10_000),
    workflowContext: workflowContextSchema,
    triage: triageAgentOutputSchema,
    bedAssignment: bedManagementAgentOutputSchema,
    staffAssignment: staffCoordinationAgentOutputSchema,
    reporting: reportingAgentOutputSchema,
});

export const rootOrchestratorAgentOutputSchema = z.object({
    response: z.string().min(1).max(4000),
});

export type WorkflowContext = z.infer<typeof workflowContextSchema>;
export type RootOrchestratorAgentInput = z.infer<
    typeof rootOrchestratorAgentInputSchema
>;
export type RootOrchestratorAgentOutput = z.infer<
    typeof rootOrchestratorAgentOutputSchema
>;
