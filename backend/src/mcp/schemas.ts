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

export const patientVitalsSchema = z.object({
    heartRate: z.number().int().positive().optional(),
    systolicBP: z.number().int().positive().optional(),
    diastolicBP: z.number().int().positive().optional(),
    oxygenSat: z.number().min(0).max(100).optional(),
    temperatureF: z.number().optional(),
});

export const upsertPatientIntakeInputSchema = z.object({
    patientId: z.string().min(1),
    smokeTestRunId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    age: z.number().int().min(0).max(130).optional(),
    chiefComplaint: z.string().min(1).optional(),
    symptoms: z.array(z.string().min(1)).optional(),
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

export const assignStaffToPatientInputSchema = z.object({
    patientId: z.string().min(1),
    staffIds: z.array(z.string().min(1)).min(1).max(10),
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

export const mcpToolSchemas = {
    get_available_beds: getAvailableBedsInputSchema,
    assign_patient_to_bed: assignPatientToBedInputSchema,
    get_available_staff: getAvailableStaffInputSchema,
    update_supply_inventory: updateSupplyInventoryInputSchema,
    log_arize_trace: logArizeTraceInputSchema,
} as const;

export type GetAvailableBedsInput = z.infer<
    typeof getAvailableBedsInputSchema
>;
export type UpsertPatientIntakeInput = z.infer<
    typeof upsertPatientIntakeInputSchema
>;
export type AssignPatientToBedInput = z.infer<
    typeof assignPatientToBedInputSchema
>;
export type GetAvailableStaffInput = z.infer<
    typeof getAvailableStaffInputSchema
>;
export type AssignStaffToPatientInput = z.infer<
    typeof assignStaffToPatientInputSchema
>;
export type UpdateSupplyInventoryInput = z.infer<
    typeof updateSupplyInventoryInputSchema
>;
export type LogArizeTraceInput = z.infer<typeof logArizeTraceInputSchema>;
