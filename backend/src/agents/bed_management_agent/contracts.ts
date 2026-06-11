import { z } from "zod";

import { bedTypeSchema } from "../../mcp/schemas.js";

export const bedCandidateSchema = z.object({
    bedId: z.string().min(1),
    type: bedTypeSchema,
    room: z.string().optional(),
    hasMonitor: z.boolean().optional(),
    version: z.number().int().nonnegative().optional(),
});

export const bedManagementAgentInputSchema = z.object({
    patientId: z.string().min(1),
    severity: z.enum(["critical", "high", "moderate", "low"]),
    urgency: z.enum(["immediate", "expedited", "standard"]),
    routingPriority: z.enum([
        "resuscitation",
        "trauma_bay",
        "monitored_bed",
        "standard_bed",
        "fast_track",
    ]),
    recommendedBedType: bedTypeSchema,
    requiresMonitor: z.boolean(),
    candidateBeds: z.array(bedCandidateSchema).max(20),
});

export const bedManagementAgentOutputSchema = z.object({
    patientId: z.string().min(1),
    assignmentStatus: z.enum(["assigned", "waitlisted"]).default("assigned"),
    selectedBedId: z.string().min(1).nullable(),
    selectedBedType: bedTypeSchema,
    rationale: z.string().min(1).max(1000),
    estimatedWaitMinutes: z.number().int().min(0).max(1440),
    appliedRules: z.array(z.string()).default([]),
});

export type BedManagementAgentInput = z.infer<
    typeof bedManagementAgentInputSchema
>;
export type BedManagementAgentOutput = z.infer<
    typeof bedManagementAgentOutputSchema
>;
