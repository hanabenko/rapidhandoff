import { MongoClient } from "mongodb";

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
    name?: string;
    age?: number;
    chiefComplaint?: string;
    triageLevel: TriageLevel;
    status: PatientStatus;
    arrivalTime: Date;
    recommendedBedType?: string;
    carePathway?: string;
    vitals?: {
        heartRate?: number | null;
        systolicBP?: number | null;
        diastolicBP?: number | null;
        oxygenSat?: number | null;
        temperatureF?: number | null;
    };
}

export interface Bed {
    bedId: string;
    room?: string;
    type: string;
    status: "occupied" | "available";
    needsCleaning: boolean;
    occupiedByPatientId?: string | null;
    hasMonitor?: boolean;
}

export interface StaffMember {
    staffId: string;
    name?: string;
    role: "physician" | "nurse" | "charge_nurse" | "paramedic" | "tech";
    available: boolean;
    currentAssignment: string | null;
    shift: "day" | "evening" | "night";
    shiftStartedAt?: Date;
    canPage?: boolean;
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

const DB_NAME = "er_system";

export async function loadErSnapshot(): Promise<ErSnapshot> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error(
            "MONGODB_URI is not configured. Add it to .env before using ER data tools.",
        );
    }

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const [patients, beds, staff, events] = await Promise.all([
            db.collection<Patient>("patients").find({}).toArray(),
            db.collection<Bed>("beds").find({}).toArray(),
            db.collection<StaffMember>("staff").find({}).toArray(),
            db
                .collection<ErEvent>("events")
                .find({})
                .sort({ timestamp: -1 })
                .limit(100)
                .toArray(),
        ]);

        return {
            capturedAt: new Date(),
            patients,
            beds,
            staff,
            events,
        };
    } finally {
        await client.close();
    }
}
