import { z } from "zod";

export const staffRoleSchema = z.enum([
    "physician",
    "nurse",
    "charge_nurse",
    "paramedic",
    "tech",
]);

export const staffCandidateSchema = z.object({
    staffId: z.string().min(1),
    role: staffRoleSchema,
    shift: z.enum(["day", "evening", "night"]),
    available: z.boolean(),
});

export const staffCoordinationAgentInputSchema = z.object({
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
    assignedBedId: z.string().min(1),
    candidateStaff: z.array(staffCandidateSchema).max(20),
    preferredShift: z.enum(["day", "evening", "night"]).optional(),
});

export const staffCoordinationAgentOutputSchema = z.object({
    patientId: z.string().min(1),
    assignmentStatus: z.enum(["assigned", "deferred"]).default("assigned"),
    assignedStaffIds: z.array(z.string().min(1)).max(5),
    assignedRoles: z.array(staffRoleSchema).max(5),
    alertMessage: z.string().min(1).max(1000),
    rationale: z.string().min(1).max(1000),
});

export type StaffCoordinationAgentInput = z.infer<
    typeof staffCoordinationAgentInputSchema
>;
export type StaffCoordinationAgentOutput = z.infer<
    typeof staffCoordinationAgentOutputSchema
>;
