import { z } from "zod";

export const bedTypeSchema = z.enum([
    "trauma",
    "exam",
    "observation",
    "isolation",
    "pediatric",
]);

export const getAvailableBedsInputSchema = z.object({
    bedType: bedTypeSchema.optional(),
    requiresMonitor: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(20),
});

export const assignPatientToBedInputSchema = z.object({
    patientId: z.string().min(1),
    bedId: z.string().min(1),
    assignedByStaffId: z.string().min(1),
    expectedBedVersion: z.number().int().nonnegative().optional(),
});

export const getAvailableStaffInputSchema = z.object({
    roles: z
        .array(
            z.enum([
                "physician",
                "nurse",
                "charge_nurse",
                "paramedic",
                "tech",
            ]),
        )
        .optional(),
    shift: z.enum(["day", "evening", "night"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
});

export const updateSupplyInventoryInputSchema = z.object({
    supplyId: z.string().min(1),
    quantityDelta: z.number().int(),
    reason: z.string().min(1).max(500),
    updatedByStaffId: z.string().min(1),
    idempotencyKey: z.string().min(1),
});

export const logArizeTraceInputSchema = z.object({
    traceId: z.string().min(1),
    operation: z.string().min(1),
    agent: z.string().min(1),
    status: z.enum(["ok", "error"]),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    errorMessage: z.string().optional(),
});

export type GetAvailableBedsInput = z.infer<
    typeof getAvailableBedsInputSchema
>;
export type AssignPatientToBedInput = z.infer<
    typeof assignPatientToBedInputSchema
>;
export type GetAvailableStaffInput = z.infer<
    typeof getAvailableStaffInputSchema
>;
export type UpdateSupplyInventoryInput = z.infer<
    typeof updateSupplyInventoryInputSchema
>;
export type LogArizeTraceInput = z.infer<typeof logArizeTraceInputSchema>;
