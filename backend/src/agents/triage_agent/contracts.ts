import { z } from "zod";

import {
    bedTypeSchema,
    patientVitalsSchema,
} from "../../mcp/schemas.js";

export const triageAgentInputSchema = z.object({
    patientId: z.string().min(1),
    age: z.number().int().min(0).max(130).optional(),
    chiefComplaint: z.string().min(1).max(500).optional(),
    symptoms: z.array(z.string().min(1).max(200)).max(20).default([]),
    vitals: patientVitalsSchema.optional(),
    reportedTriageLevel: z
        .enum([
            "critical",
            "emergent",
            "urgent",
            "less_urgent",
            "non_urgent",
        ])
        .optional(),
    requestedBedType: bedTypeSchema.optional(),
    requiresMonitor: z.boolean().optional(),
});

export const triageAgentOutputSchema = z.object({
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
    rationale: z.string().min(1).max(1000),
});

export type TriageAgentInput = z.infer<typeof triageAgentInputSchema>;
export type TriageAgentOutput = z.infer<typeof triageAgentOutputSchema>;
