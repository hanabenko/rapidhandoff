import { MongoClient } from "mongodb";
import "dotenv/config";

const DB_NAME = "er_system";

const uri = process.env.MONGODB_URI;

if (!uri) {
    throw new Error("Missing MONGODB_URI");
}

const client = new MongoClient(uri);

const rand = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
    await client.connect();

    const db = client.db(DB_NAME);

    const collections = ["patients", "beds", "staff", "supplies", "events"];

    for (const name of collections) {
        await db.collection(name).deleteMany({});
    }

    const patients = Array.from({ length: 25 }, (_, i) => ({
        patientId: `P-${String(i + 1).padStart(4, "0")}`,
        name: pick([
            "Ava Thompson",
            "Marcus Rivera",
            "Sofia Chen",
            "Noah Patel",
            "Mia Johnson",
            "Ethan Brooks",
            "Priya Shah",
            "Daniel Kim",
            "Grace Miller",
            "Owen Davis",
            "Fatima Hassan",
            "Liam Anderson",
        ]),
        age: rand(2, 90),
        triageLevel: pick([
            "critical",
            "emergent",
            "urgent",
            "less_urgent",
            "non_urgent",
        ]),
        chiefComplaint: pick([
            "Chest pain",
            "Shortness of breath",
            "Abdominal pain",
            "High fever",
            "Laceration",
            "Fracture",
            "Allergic reaction",
        ]),
        status: pick(["waiting", "in_treatment", "admitted", "discharged"]),
        arrivalTime: new Date(Date.now() - rand(5, 420) * 60_000),
        vitals: {
            heartRate: rand(58, 145),
            systolicBP: rand(90, 175),
            diastolicBP: rand(55, 110),
            oxygenSat: rand(82, 100),
            temperatureF: Number((rand(970, 1035) / 10).toFixed(1)),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
    }));

    const beds = Array.from({ length: 18 }, (_, i) => {
        const occupied = Math.random() < 0.55;

        return {
            bedId: `B-${String(i + 1).padStart(3, "0")}`,
            room: `ER-${100 + i}`,
            type: pick([
                "trauma",
                "exam",
                "observation",
                "isolation",
                "pediatric",
            ]),
            status: occupied ? "occupied" : "available",
            occupiedByPatientId: occupied ? pick(patients).patientId : null,
            needsCleaning: !occupied && Math.random() < 0.25,
            hasMonitor: Math.random() < 0.75,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    });

    const staff = Array.from({ length: 14 }, (_, i) => ({
        staffId: `S-${String(i + 1).padStart(3, "0")}`,
        name: pick([
            "Dr. Elena Morris",
            "Dr. James Carter",
            "Dr. Aisha Khan",
            "Rachel Green",
            "Miguel Santos",
            "Tina Brooks",
            "Sam Wilson",
            "Jordan Lee",
            "Morgan Blake",
            "Priya Nair",
        ]),
        role: pick(["physician", "nurse", "charge_nurse", "paramedic", "tech"]),
        department: "Emergency",
        available: Math.random() < 0.7,
        currentAssignment:
            Math.random() < 0.45 ? pick(patients).patientId : null,
        shift: pick(["day", "evening", "night"]),
        createdAt: new Date(),
        updatedAt: new Date(),
    }));

    const supplies = [
        "Nitrile gloves",
        "Surgical masks",
        "N95 respirators",
        "IV start kits",
        "Saline bags",
        "Lactated Ringers",
        "Gauze pads",
        "Elastic bandages",
        "Syringes 5mL",
        "Syringes 10mL",
        "Alcohol prep pads",
        "Suture kits",
        "ECG electrodes",
        "Pulse oximeter probes",
        "Oxygen cannulas",
        "Nebulizer kits",
        "Epinephrine",
        "Naloxone",
        "Acetaminophen",
        "Ibuprofen",
        "Ondansetron",
        "Diphenhydramine",
        "Ceftriaxone",
        "Trauma shears",
        "Thermometer covers",
        "Specimen cups",
        "Blood culture bottles",
        "Rapid flu tests",
        "Glucose test strips",
        "IV tubing",
    ].map((name, i) => {
        const quantity = rand(5, 250);
        const reorderLevel = rand(10, 60);

        return {
            supplyId: `SUP-${String(i + 1).padStart(3, "0")}`,
            name,
            category: pick([
                "ppe",
                "medication",
                "iv",
                "wound_care",
                "diagnostic",
                "respiratory",
            ]),
            quantity,
            unit: pick(["each", "box", "case", "bag", "kit"]),
            reorderLevel,
            status: quantity <= reorderLevel ? "low_stock" : "in_stock",
            location: pick([
                "Supply Room A",
                "Trauma Bay",
                "Medication Cabinet",
                "Nurse Station",
            ]),
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    });

    const events = Array.from({ length: 40 }, (_, i) => ({
        eventId: `EVT-${String(i + 1).padStart(4, "0")}`,
        type: pick([
            "patient_arrived",
            "triage_completed",
            "bed_assigned",
            "staff_assigned",
            "vitals_updated",
            "supply_used",
            "patient_discharged",
        ]),
        patientId: pick(patients).patientId,
        staffId: pick(staff).staffId,
        bedId: Math.random() < 0.5 ? pick(beds).bedId : null,
        severity: pick(["info", "warning", "critical"]),
        message: "Generated ER system demo event.",
        timestamp: new Date(Date.now() - rand(1, 480) * 60_000),
        createdAt: new Date(),
    }));

    await db.collection("patients").insertMany(patients);
    await db.collection("beds").insertMany(beds);
    await db.collection("staff").insertMany(staff);
    await db.collection("supplies").insertMany(supplies);
    await db.collection("events").insertMany(events);

    console.log(`Seeded database: ${DB_NAME}`);

    for (const name of collections) {
        const count = await db.collection(name).countDocuments();
        console.log(name, count);
    }

    await client.close();
}

main().catch(async (err) => {
    console.error(err);
    await client.close();
    process.exit(1);
});
