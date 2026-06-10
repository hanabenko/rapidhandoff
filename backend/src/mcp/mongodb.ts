import { BSON } from "mongodb";
import { z } from "zod";

import { RemoteMcpClient } from "./client.js";
import { getMongoMcpConfig } from "./config.js";
import {
    assignPatientToBedInputSchema,
    assignStaffToPatientInputSchema,
    getAvailableBedsInputSchema,
    getAvailableStaffInputSchema,
    updateSupplyInventoryInputSchema,
    upsertPatientIntakeInputSchema,
    type AssignPatientToBedInput,
    type AssignStaffToPatientInput,
    type GetAvailableBedsInput,
    type GetAvailableStaffInput,
    type UpdateSupplyInventoryInput,
    type UpsertPatientIntakeInput,
} from "./schemas.js";

export type PatientStatus =
    | "waiting"
    | "in_treatment"
    | "admitted"
    | "discharged";

export type TriageLevel =
    | "critical"
    | "emergent"
    | "urgent"
    | "less_urgent"
    | "non_urgent";

export interface Patient {
    patientId: string;
    triageLevel?: TriageLevel;
    status: PatientStatus;
    arrivalTime: Date;
}

export interface Bed {
    bedId: string;
    room?: string;
    type: string;
    status: "occupied" | "available";
    needsCleaning: boolean;
    hasMonitor?: boolean;
    version?: number;
}

export interface StaffMember {
    staffId: string;
    name?: string;
    role: "physician" | "nurse" | "charge_nurse" | "paramedic" | "tech";
    available: boolean;
    currentAssignment: string | null;
    shift: "day" | "evening" | "night";
}

export interface ErEvent {
    eventId: string;
    type: string;
    severity: "info" | "warning" | "critical";
    message: string;
    timestamp: Date;
}

export interface ErSnapshot {
    capturedAt: Date;
    patients: Patient[];
    beds: Bed[];
    staff: StaffMember[];
    events: ErEvent[];
}

export interface MongoMcpToolClient {
    callTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<unknown>;
    close?(): Promise<void>;
}

export interface MongoErRepository {
    loadSnapshot(): Promise<ErSnapshot>;
    upsertPatientIntake(input: UpsertPatientIntakeInput): Promise<unknown>;
    getAvailableBeds(input: GetAvailableBedsInput): Promise<Bed[]>;
    assignPatientToBed(input: AssignPatientToBedInput): Promise<unknown>;
    getAvailableStaff(input: GetAvailableStaffInput): Promise<StaffMember[]>;
    assignStaffToPatient(input: AssignStaffToPatientInput): Promise<unknown>;
    updateSupplyInventory(input: UpdateSupplyInventoryInput): Promise<unknown>;
    close(): Promise<void>;
}

const patientSchema = z.object({
    patientId: z.string(),
    triageLevel: z
        .enum([
            "critical",
            "emergent",
            "urgent",
            "less_urgent",
            "non_urgent",
        ])
        .optional(),
    status: z.enum(["waiting", "in_treatment", "admitted", "discharged"]),
    arrivalTime: z.coerce.date(),
});

const bedSchema = z.object({
    bedId: z.string(),
    room: z.string().optional(),
    type: z.string(),
    status: z.enum(["occupied", "available"]),
    needsCleaning: z.boolean().default(false),
    hasMonitor: z.boolean().optional(),
    version: z.number().int().optional(),
});

const staffSchema = z.object({
    staffId: z.string(),
    name: z.string().optional(),
    role: z.enum(["physician", "nurse", "charge_nurse", "paramedic", "tech"]),
    available: z.boolean(),
    currentAssignment: z.string().nullable().default(null),
    shift: z.enum(["day", "evening", "night"]),
});

const eventSchema = z.object({
    eventId: z.string(),
    type: z.string(),
    severity: z.enum(["info", "warning", "critical"]),
    message: z.string(),
    timestamp: z.coerce.date(),
});

function textContent(result: unknown): string[] {
    if (!result || typeof result !== "object") {
        return [];
    }

    const record = result as Record<string, unknown>;
    if (record.isError === true) {
        const message = Array.isArray(record.content)
            ? record.content
                  .map((item) =>
                      item &&
                      typeof item === "object" &&
                      typeof (item as Record<string, unknown>).text === "string"
                          ? (item as Record<string, unknown>).text
                          : "",
                  )
                  .filter(Boolean)
                  .join(" ")
            : "MongoDB MCP tool call failed.";
        throw new Error(message);
    }

    if (!Array.isArray(record.content)) {
        return [];
    }

    return record.content.flatMap((item) => {
        if (!item || typeof item !== "object") {
            return [];
        }
        const itemRecord = item as Record<string, unknown>;
        return itemRecord.type === "text" && typeof itemRecord.text === "string"
            ? [itemRecord.text]
            : [];
    });
}

function documentsFromFind(result: unknown): unknown[] {
    const documents: unknown[] = [];

    for (const text of textContent(result)) {
        try {
            const parsed = BSON.EJSON.parse(text, { relaxed: true });
            if (Array.isArray(parsed)) {
                documents.push(...parsed);
            } else if (parsed && typeof parsed === "object") {
                documents.push(parsed);
            }
        } catch {
            // The official find tool includes a human-readable summary item.
        }
    }

    return documents;
}

function updateCounts(result: unknown): {
    matched: number;
    modified: number;
    upserted: number;
} {
    if (result && typeof result === "object") {
        const structuredContent = (result as Record<string, unknown>)
            .structuredContent;
        if (structuredContent && typeof structuredContent === "object") {
            const counts = structuredContent as Record<string, unknown>;
            return {
                matched:
                    typeof counts.matchedCount === "number"
                        ? counts.matchedCount
                        : 0,
                modified:
                    typeof counts.modifiedCount === "number"
                        ? counts.modifiedCount
                        : 0,
                upserted:
                    typeof counts.upsertedCount === "number"
                        ? counts.upsertedCount
                        : 0,
            };
        }
    }

    const message = textContent(result).join(" ");
    const count = (pattern: RegExp) =>
        Number.parseInt(message.match(pattern)?.[1] ?? "0", 10);

    return {
        matched: count(/Matched (\d+) document/),
        modified: count(/Modified (\d+) document/),
        upserted: count(/Upserted (\d+) document/),
    };
}

function mongoDate(value: string): { $date: string } {
    return { $date: value };
}

export class MongoErMcpAdapter implements MongoErRepository {
    private readonly client: MongoMcpToolClient;
    private readonly database: string;

    constructor(
        client?: MongoMcpToolClient,
        options: {
            env?: NodeJS.ProcessEnv;
            database?: string;
        } = {},
    ) {
        const env = options.env ?? process.env;
        this.client =
            client ??
            new RemoteMcpClient("mongodb", getMongoMcpConfig(env));
        this.database =
            options.database ?? env.MONGODB_MCP_DATABASE ?? "er_system";
    }

    async loadSnapshot(): Promise<ErSnapshot> {
        const [patients, beds, staff, events] = await Promise.all([
            this.find("patients", {}, { limit: 1_000 }),
            this.find("beds", {}, { limit: 1_000 }),
            this.find("staff", {}, { limit: 1_000 }),
            this.find("events", {}, { limit: 100, sort: { timestamp: -1 } }),
        ]);

        return {
            capturedAt: new Date(),
            patients: z.array(patientSchema).parse(patients),
            beds: z.array(bedSchema).parse(beds),
            staff: z.array(staffSchema).parse(staff),
            events: z.array(eventSchema).parse(events),
        };
    }

    async upsertPatientIntake(input: UpsertPatientIntakeInput) {
        const parsed = upsertPatientIntakeInputSchema.parse(input);
        const now = new Date().toISOString();
        const set: Record<string, unknown> = {
            ...parsed,
            updatedAt: mongoDate(now),
        };

        if (parsed.arrivalTime) {
            set.arrivalTime = mongoDate(parsed.arrivalTime);
        }

        const setOnInsert: Record<string, unknown> = {
            createdAt: mongoDate(now),
        };
        if (!parsed.arrivalTime) {
            setOnInsert.arrivalTime = mongoDate(now);
        }
        if (!parsed.status) {
            setOnInsert.status = "waiting";
        }

        const counts = updateCounts(
            await this.updateMany(
                "patients",
                { patientId: parsed.patientId },
                {
                    $set: set,
                    $setOnInsert: setOnInsert,
                },
                true,
            ),
        );

        if (counts.matched + counts.upserted !== 1) {
            throw new Error(
                `Patient intake upsert affected ${counts.matched + counts.upserted} records.`,
            );
        }

        return {
            patientId: parsed.patientId,
            status: counts.upserted === 1 ? "created" : "updated",
        };
    }

    async getAvailableBeds(input: GetAvailableBedsInput): Promise<Bed[]> {
        const parsed = getAvailableBedsInputSchema.parse(input);
        const filter: Record<string, unknown> = {
            status: "available",
            needsCleaning: false,
        };
        if (parsed.bedType) {
            filter.type = parsed.bedType;
        }
        if (parsed.requiresMonitor) {
            filter.hasMonitor = true;
        }

        return z
            .array(bedSchema)
            .parse(
                await this.find("beds", filter, {
                    limit: parsed.limit,
                    sort: { room: 1 },
                }),
            );
    }

    async assignPatientToBed(input: AssignPatientToBedInput) {
        const parsed = assignPatientToBedInputSchema.parse(input);
        const now = new Date().toISOString();
        const bedFilter: Record<string, unknown> = {
            bedId: parsed.bedId,
            status: "available",
            needsCleaning: false,
        };
        if (parsed.expectedBedVersion !== undefined) {
            bedFilter.version = parsed.expectedBedVersion;
        }

        const bedCounts = updateCounts(
            await this.updateMany("beds", bedFilter, {
                $set: {
                    status: "occupied",
                    occupiedByPatientId: parsed.patientId,
                    updatedAt: mongoDate(now),
                },
                $inc: { version: 1 },
            }),
        );
        if (bedCounts.matched !== 1) {
            throw new Error(
                `Bed ${parsed.bedId} is no longer available for assignment.`,
            );
        }

        const patientCounts = updateCounts(
            await this.updateMany(
                "patients",
                { patientId: parsed.patientId },
                {
                    $set: {
                        assignedBedId: parsed.bedId,
                        assignedByStaffId: parsed.assignedByStaffId,
                        status: "in_treatment",
                        updatedAt: mongoDate(now),
                    },
                },
            ),
        );

        if (patientCounts.matched !== 1) {
            // The official MCP server does not expose multi-document
            // transactions. Release the conditionally reserved bed so a
            // failed patient update does not leave it stranded.
            await this.updateMany(
                "beds",
                {
                    bedId: parsed.bedId,
                    occupiedByPatientId: parsed.patientId,
                },
                {
                    $set: {
                        status: "available",
                        occupiedByPatientId: null,
                        updatedAt: mongoDate(new Date().toISOString()),
                    },
                    $inc: { version: 1 },
                },
            );
            throw new Error(`Patient ${parsed.patientId} was not found.`);
        }

        return {
            status: "assigned",
            patientId: parsed.patientId,
            bedId: parsed.bedId,
        };
    }

    async getAvailableStaff(
        input: GetAvailableStaffInput,
    ): Promise<StaffMember[]> {
        const parsed = getAvailableStaffInputSchema.parse(input);
        const filter: Record<string, unknown> = { available: true };
        if (parsed.roles?.length) {
            filter.role = { $in: parsed.roles };
        }
        if (parsed.shift) {
            filter.shift = parsed.shift;
        }

        return z
            .array(staffSchema)
            .parse(
                await this.find("staff", filter, {
                    limit: parsed.limit,
                    sort: { role: 1, name: 1 },
                }),
            );
    }

    async assignStaffToPatient(input: AssignStaffToPatientInput) {
        const parsed = assignStaffToPatientInputSchema.parse(input);
        const assigned: string[] = [];

        try {
            for (const staffId of parsed.staffIds) {
                const counts = updateCounts(
                    await this.updateMany(
                        "staff",
                        { staffId, available: true },
                        {
                            $set: {
                                available: false,
                                currentAssignment: parsed.patientId,
                                updatedAt: mongoDate(new Date().toISOString()),
                            },
                        },
                    ),
                );
                if (counts.matched !== 1) {
                    throw new Error(
                        `Staff member ${staffId} is no longer available.`,
                    );
                }
                assigned.push(staffId);
            }

            const patientCounts = updateCounts(
                await this.updateMany(
                    "patients",
                    { patientId: parsed.patientId },
                    {
                        $set: {
                            assignedStaffIds: parsed.staffIds,
                            updatedAt: mongoDate(new Date().toISOString()),
                        },
                    },
                ),
            );
            if (patientCounts.matched !== 1) {
                throw new Error(`Patient ${parsed.patientId} was not found.`);
            }
        } catch (error) {
            await Promise.allSettled(
                assigned.map((staffId) =>
                    this.updateMany(
                        "staff",
                        {
                            staffId,
                            currentAssignment: parsed.patientId,
                        },
                        {
                            $set: {
                                available: true,
                                currentAssignment: null,
                                updatedAt: mongoDate(new Date().toISOString()),
                            },
                        },
                    ),
                ),
            );
            throw error;
        }

        return {
            status: "assigned",
            patientId: parsed.patientId,
            staffIds: parsed.staffIds,
        };
    }

    async updateSupplyInventory(input: UpdateSupplyInventoryInput) {
        const parsed = updateSupplyInventoryInputSchema.parse(input);
        return this.updateMany(
            "supplies",
            { supplyId: parsed.supplyId },
            {
                $inc: { quantity: parsed.quantityDelta },
                $set: {
                    updatedAt: mongoDate(new Date().toISOString()),
                    lastUpdateReason: parsed.reason,
                    lastUpdatedByStaffId: parsed.updatedByStaffId,
                    lastIdempotencyKey: parsed.idempotencyKey,
                },
            },
        );
    }

    async close(): Promise<void> {
        await this.client.close?.();
    }

    private async find(
        collection: string,
        filter: Record<string, unknown>,
        options: {
            limit: number;
            sort?: Record<string, unknown>;
        },
    ): Promise<unknown[]> {
        return documentsFromFind(
            await this.client.callTool("find", {
                database: this.database,
                collection,
                filter,
                limit: options.limit,
                ...(options.sort ? { sort: options.sort } : {}),
            }),
        );
    }

    private updateMany(
        collection: string,
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        upsert = false,
    ): Promise<unknown> {
        return this.client.callTool("update-many", {
            database: this.database,
            collection,
            filter,
            update,
            ...(upsert ? { upsert: true } : {}),
        });
    }
}
