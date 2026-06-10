import { FunctionTool } from "@google/adk";
import { MongoClient } from "mongodb";
import { z } from "zod";

const DB_NAME = "er_system";

async function withDb<T>(
    operation: (db: ReturnType<MongoClient["db"]>) => Promise<T>,
): Promise<T> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error(
            "MONGODB_URI is not configured. Add it to .env before using ER action tools.",
        );
    }
    const client = new MongoClient(uri);
    try {
        await client.connect();
        return await operation(client.db(DB_NAME));
    } finally {
        await client.close();
    }
}

function nextId(prefix: string, count: number): string {
    return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

async function logEvent(
    db: ReturnType<MongoClient["db"]>,
    fields: {
        type: string;
        patientId?: string;
        staffId?: string;
        bedId?: string;
        severity: "info" | "warning" | "critical";
        message: string;
    },
): Promise<void> {
    const count = await db.collection("events").countDocuments();
    await db.collection("events").insertOne({
        eventId: nextId("EVT", count),
        ...fields,
        timestamp: new Date(),
        createdAt: new Date(),
    });
}

export const intakePatientTool = new FunctionTool({
    name: "intake_patient",
    description:
        "Register a new patient in the ER system with their triage assessment. " +
        "Call this after reasoning about the ESI triage level from symptoms and vitals.",
    parameters: z.object({
        name: z.string().min(1).max(200).describe("Patient full name"),
        age: z.number().int().min(0).max(150).describe("Patient age in years"),
        chiefComplaint: z.string().min(1).max(500).describe("Primary reason for visit"),
        triageLevel: z
            .enum(["critical", "emergent", "urgent", "less_urgent", "non_urgent"])
            .describe("ESI triage level assessed from vitals and symptoms"),
        carePathway: z
            .string()
            .min(1)
            .max(1000)
            .describe("Brief clinical care pathway and reasoning for the triage decision"),
        recommendedBedType: z
            .enum(["trauma", "exam", "observation", "isolation", "pediatric"])
            .describe("Bed type appropriate for this patient's triage level"),
        vitals: z.object({
            heartRate: z.number().int().describe("Beats per minute"),
            systolicBP: z.number().int().describe("Systolic blood pressure mmHg"),
            diastolicBP: z.number().int().describe("Diastolic blood pressure mmHg"),
            oxygenSat: z.number().int().min(0).max(100).describe("SpO2 percent"),
            temperatureF: z.number().describe("Temperature in Fahrenheit"),
        }),
    }),
    execute: async ({ name, age, chiefComplaint, triageLevel, carePathway, recommendedBedType, vitals }) => {
        try {
            return await withDb(async (db) => {
                const count = await db.collection("patients").countDocuments();
                const patientId = nextId("P", count);

                await db.collection("patients").insertOne({
                    patientId,
                    name,
                    age,
                    chiefComplaint,
                    triageLevel,
                    carePathway,
                    recommendedBedType,
                    status: "waiting",
                    arrivalTime: new Date(),
                    vitals,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                await logEvent(db, {
                    type: "patient_arrived",
                    patientId,
                    severity: triageLevel === "critical" || triageLevel === "emergent" ? "critical" : "info",
                    message: `${name} registered — triage level: ${triageLevel}. Complaint: ${chiefComplaint}.`,
                });

                return {
                    status: "ok",
                    patientId,
                    name,
                    triageLevel,
                    carePathway,
                    recommendedBedType,
                    message: `Patient ${name} registered as ${patientId} with triage level ${triageLevel}.`,
                };
            });
        } catch (error) {
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Failed to register patient.",
            };
        }
    },
});

export const getAvailableBedsTool = new FunctionTool({
    name: "get_available_beds",
    description:
        "Query the ER for beds that are available and ready (not awaiting cleaning). " +
        "Filter by bed type to match a patient's triage level.",
    parameters: z.object({
        bedType: z
            .enum(["trauma", "exam", "observation", "isolation", "pediatric"])
            .optional()
            .describe("Preferred bed type. Omit to see all available beds."),
        requiresMonitor: z
            .boolean()
            .optional()
            .describe("Set true to restrict to beds that have a cardiac monitor."),
        limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .describe("Maximum number of beds to return."),
    }),
    execute: async ({ bedType, requiresMonitor, limit }) => {
        try {
            return await withDb(async (db) => {
                const filter: Record<string, unknown> = {
                    status: "available",
                    needsCleaning: false,
                };
                if (bedType) filter.type = bedType;
                if (requiresMonitor === true) filter.hasMonitor = true;

                const beds = await db
                    .collection("beds")
                    .find(filter)
                    .limit(limit)
                    .toArray();

                return {
                    status: "ok",
                    availableCount: beds.length,
                    beds: beds.map((b) => ({
                        bedId: b.bedId,
                        room: b.room,
                        type: b.type,
                        hasMonitor: b.hasMonitor ?? false,
                    })),
                };
            });
        } catch (error) {
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Failed to query beds.",
            };
        }
    },
});

export const assignPatientToBedTool = new FunctionTool({
    name: "assign_patient_to_bed",
    description:
        "Assign a patient to a specific bed. Updates both the bed (occupied) " +
        "and the patient (in_treatment) records in MongoDB.",
    parameters: z.object({
        patientId: z.string().min(1).describe("Patient ID from intake_patient"),
        bedId: z.string().min(1).describe("Bed ID from get_available_beds"),
    }),
    execute: async ({ patientId, bedId }) => {
        try {
            return await withDb(async (db) => {
                const [bedResult, patientResult] = await Promise.all([
                    db.collection("beds").updateOne(
                        { bedId, status: "available" },
                        {
                            $set: {
                                status: "occupied",
                                occupiedByPatientId: patientId,
                                updatedAt: new Date(),
                            },
                        },
                    ),
                    db.collection("patients").updateOne(
                        { patientId },
                        {
                            $set: {
                                status: "in_treatment",
                                assignedBedId: bedId,
                                updatedAt: new Date(),
                            },
                        },
                    ),
                ]);

                if (bedResult.matchedCount === 0) {
                    return {
                        status: "error",
                        message: `Bed ${bedId} is no longer available — it may have just been assigned. Try get_available_beds again.`,
                    };
                }

                if (patientResult.matchedCount === 0) {
                    return {
                        status: "error",
                        message: `Patient ${patientId} not found. Verify the patient ID from intake_patient.`,
                    };
                }

                await logEvent(db, {
                    type: "bed_assigned",
                    patientId,
                    bedId,
                    severity: "info",
                    message: `Patient ${patientId} assigned to bed ${bedId}.`,
                });

                return {
                    status: "ok",
                    patientId,
                    bedId,
                    message: `Patient ${patientId} is now in bed ${bedId} and status updated to in_treatment.`,
                };
            });
        } catch (error) {
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Failed to assign bed.",
            };
        }
    },
});

export const getAvailableStaffTool = new FunctionTool({
    name: "get_available_staff",
    description:
        "Query ER staff who are currently available (not assigned to another patient). " +
        "Filter by role to find the right coverage for a patient's acuity.",
    parameters: z.object({
        roles: z
            .array(z.enum(["physician", "nurse", "charge_nurse", "paramedic", "tech"]))
            .optional()
            .describe(
                "Roles to filter for. For ESI 1-2 request [physician, nurse]. " +
                "For ESI 3-4 request [nurse]. For ESI 5 request [nurse, tech].",
            ),
        limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .default(5)
            .describe("Maximum number of staff members to return."),
    }),
    execute: async ({ roles, limit }) => {
        try {
            return await withDb(async (db) => {
                const filter: Record<string, unknown> = { available: true };
                if (roles?.length) filter.role = { $in: roles };

                const staff = await db
                    .collection("staff")
                    .find(filter)
                    .limit(limit)
                    .toArray();

                return {
                    status: "ok",
                    availableCount: staff.length,
                    staff: staff.map((s) => ({
                        staffId: s.staffId,
                        name: s.name,
                        role: s.role,
                        shift: s.shift,
                    })),
                };
            });
        } catch (error) {
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Failed to query staff.",
            };
        }
    },
});

export const assignStaffToPatientTool = new FunctionTool({
    name: "assign_staff_to_patient",
    description:
        "Assign a staff member to a patient. Marks the staff member as unavailable " +
        "and records their current assignment in MongoDB.",
    parameters: z.object({
        staffId: z.string().min(1).describe("Staff ID from get_available_staff"),
        patientId: z.string().min(1).describe("Patient ID from intake_patient"),
    }),
    execute: async ({ staffId, patientId }) => {
        try {
            return await withDb(async (db) => {
                const result = await db.collection("staff").updateOne(
                    { staffId, available: true },
                    {
                        $set: {
                            available: false,
                            currentAssignment: patientId,
                            updatedAt: new Date(),
                        },
                    },
                );

                if (result.matchedCount === 0) {
                    return {
                        status: "error",
                        message: `Staff member ${staffId} is no longer available. Try get_available_staff again.`,
                    };
                }

                await logEvent(db, {
                    type: "staff_assigned",
                    patientId,
                    staffId,
                    severity: "info",
                    message: `Staff ${staffId} assigned to patient ${patientId}.`,
                });

                return {
                    status: "ok",
                    staffId,
                    patientId,
                    message: `Staff member ${staffId} is now assigned to patient ${patientId}.`,
                };
            });
        } catch (error) {
            return {
                status: "error",
                message: error instanceof Error ? error.message : "Failed to assign staff.",
            };
        }
    },
});
