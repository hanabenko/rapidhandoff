import { z } from "zod";

import { bedManagementAgentOutputSchema } from "../bed_management_agent/contracts.js";
import { staffCoordinationAgentOutputSchema } from "../staff_coordination_agent/contracts.js";
import { triageAgentOutputSchema } from "../triage_agent/contracts.js";

export const dashboardStatusSchema = z.object({
    patientId: z.string().min(1),
    triageSeverity: z.enum(["critical", "high", "moderate", "low"]),
    routingPriority: z.enum([
        "resuscitation",
        "trauma_bay",
        "monitored_bed",
        "standard_bed",
        "fast_track",
    ]),
    bedId: z.string().min(1),
    assignedStaffIds: z.array(z.string().min(1)).min(1).max(5),
    estimatedWaitMinutes: z.number().int().min(0).max(1440),
});

export const reportingAgentInputSchema = z.object({
    patientId: z.string().min(1),
    triage: triageAgentOutputSchema,
    bedAssignment: bedManagementAgentOutputSchema,
    staffAssignment: staffCoordinationAgentOutputSchema,
    censusSummary: z.record(z.string(), z.unknown()),
    bedCapacitySummary: z.record(z.string(), z.unknown()),
    staffingSummary: z.record(z.string(), z.unknown()),
});

export const reportingAgentOutputSchema = z.object({
    patientId: z.string().min(1),
    operationalSummary: z.string().min(1).max(1500),
    dashboardStatus: dashboardStatusSchema,
    criticalAlerts: z.array(z.string().min(1).max(300)).max(10),
});

export type ReportingAgentInput = z.infer<typeof reportingAgentInputSchema>;
export type ReportingAgentOutput = z.infer<typeof reportingAgentOutputSchema>;
