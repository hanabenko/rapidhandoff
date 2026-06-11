import { MongoClient } from "mongodb";
import "dotenv/config";

const DB_NAME = "er_system";
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Missing MONGODB_URI");
const client = new MongoClient(uri);

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function main() {
    await client.connect();
    const db = client.db(DB_NAME);
    for (const c of ["patients", "beds", "staff", "supplies", "events"])
        await db.collection(c).deleteMany({});

    // ── PATIENTS ─────────────────────────────────────────────────────────────
    // Designed to surface all three action types on the dashboard:
    //   • 3 beds needing cleaning  → cleaning actions (auto-assign top patient after clean)
    //   • 4 ESI 1-3 patients without nurse coverage  → paging actions
    //   • 2 nurses near 10-hour shift limit  → shift alerts
    const patients = [
        // ESI 1 — critical, waiting (no bed available yet)
        {
            patientId: "P-0001",
            name: "James Carter",
            age: 67,
            triageLevel: "critical",
            chiefComplaint: "Chest pain radiating to left arm with diaphoresis",
            status: "waiting",
            arrivalTime: ago(8),
            recommendedBedType: "trauma",
            carePathway: "Immediate ECG, cardiac enzymes, IV access, cardiology page",
            vitals: { heartRate: 112, systolicBP: 88, diastolicBP: 60, oxygenSat: 94, temperatureF: 98.4 },
        },
        // ESI 2 — emergent, waiting
        {
            patientId: "P-0002",
            name: "Sofia Chen",
            age: 42,
            triageLevel: "emergent",
            chiefComplaint: "Chest pain and shortness of breath",
            status: "waiting",
            arrivalTime: ago(14),
            recommendedBedType: "trauma",
            carePathway: "Oxygen supplementation, 12-lead ECG, troponin draw",
            vitals: { heartRate: 128, systolicBP: 104, diastolicBP: 68, oxygenSat: 91, temperatureF: 99.1 },
        },
        // ESI 2 — in treatment, no nurse
        {
            patientId: "P-0003",
            name: "Owen Davis",
            age: 45,
            triageLevel: "emergent",
            chiefComplaint: "Sudden slurred speech and right-arm weakness",
            status: "in_treatment",
            assignedBedId: "B-001",
            arrivalTime: ago(22),
            recommendedBedType: "trauma",
            carePathway: "Stat CT head, stroke protocol activation, neurology consult",
            vitals: { heartRate: 95, systolicBP: 168, diastolicBP: 102, oxygenSat: 97, temperatureF: 98.6 },
        },
        // ESI 2 — in treatment, no nurse
        {
            patientId: "P-0004",
            name: "Ava Thompson",
            age: 61,
            triageLevel: "emergent",
            chiefComplaint: "Altered mental status, confused and not responding normally",
            status: "in_treatment",
            assignedBedId: "B-002",
            arrivalTime: ago(31),
            recommendedBedType: "trauma",
            carePathway: "Blood glucose, full neuro exam, CT head, toxicology screen",
            vitals: { heartRate: 102, systolicBP: 145, diastolicBP: 90, oxygenSat: 96, temperatureF: 101.3 },
        },
        // ESI 3 — urgent pediatric, waiting
        {
            patientId: "P-0005",
            name: "Mia Johnson",
            age: 8,
            triageLevel: "urgent",
            chiefComplaint: "Fever 104°F and febrile seizure 20 minutes ago",
            status: "waiting",
            arrivalTime: ago(18),
            recommendedBedType: "pediatric",
            carePathway: "Antipyretics, continuous monitoring, seizure precautions",
            vitals: { heartRate: 136, systolicBP: 98, diastolicBP: 62, oxygenSat: 98, temperatureF: 104.2 },
        },
        // ESI 3 — urgent, waiting (anaphylaxis)
        {
            patientId: "P-0006",
            name: "Noah Patel",
            age: 35,
            triageLevel: "urgent",
            chiefComplaint: "Anaphylactic reaction to peanuts — hives and throat tightening",
            status: "waiting",
            arrivalTime: ago(11),
            recommendedBedType: "exam",
            carePathway: "Epinephrine if progression, Benadryl, IV access, O2 standby",
            vitals: { heartRate: 118, systolicBP: 110, diastolicBP: 72, oxygenSat: 96, temperatureF: 98.8 },
        },
        // ESI 3 — in treatment, HAS nurse (Miguel Santos → won't appear in paging list)
        {
            patientId: "P-0007",
            name: "Marcus Rivera",
            age: 28,
            triageLevel: "urgent",
            chiefComplaint: "Severe abdominal pain with rebound tenderness",
            status: "in_treatment",
            assignedBedId: "B-003",
            arrivalTime: ago(48),
            recommendedBedType: "exam",
            carePathway: "Abdominal CT, surgical consult, pain management",
            vitals: { heartRate: 108, systolicBP: 122, diastolicBP: 78, oxygenSat: 99, temperatureF: 100.4 },
        },
        // ESI 3 — in treatment, HAS nurse (Tina Brooks → won't appear in paging list)
        {
            patientId: "P-0008",
            name: "Grace Miller",
            age: 71,
            triageLevel: "urgent",
            chiefComplaint: "Fall from standing, hip pain, unable to bear weight",
            status: "in_treatment",
            assignedBedId: "B-004",
            arrivalTime: ago(65),
            recommendedBedType: "exam",
            carePathway: "Pelvis and hip X-ray, IV pain management, PT consult",
            vitals: { heartRate: 82, systolicBP: 138, diastolicBP: 84, oxygenSat: 97, temperatureF: 98.9 },
        },
        // ESI 4 — less urgent, in the queue
        {
            patientId: "P-0009",
            name: "Ethan Brooks",
            age: 23,
            triageLevel: "less_urgent",
            chiefComplaint: "Laceration on right forearm, bleeding controlled with pressure",
            status: "waiting",
            arrivalTime: ago(82),
            recommendedBedType: "exam",
            carePathway: "Wound irrigation, suture repair",
            vitals: { heartRate: 78, systolicBP: 118, diastolicBP: 74, oxygenSat: 99, temperatureF: 98.2 },
        },
        {
            patientId: "P-0010",
            name: "Priya Shah",
            age: 31,
            triageLevel: "less_urgent",
            chiefComplaint: "Dysuria and flank pain — likely UTI",
            status: "waiting",
            arrivalTime: ago(105),
            recommendedBedType: "exam",
            carePathway: "Urinalysis, urine culture, oral antibiotics",
            vitals: { heartRate: 76, systolicBP: 116, diastolicBP: 72, oxygenSat: 99, temperatureF: 99.7 },
        },
        {
            patientId: "P-0011",
            name: "Liam Anderson",
            age: 5,
            triageLevel: "less_urgent",
            chiefComplaint: "Ear pain since this morning, tugging at left ear",
            status: "waiting",
            arrivalTime: ago(118),
            recommendedBedType: "pediatric",
            carePathway: "Ear exam, antibiotics if acute otitis media confirmed",
            vitals: { heartRate: 96, systolicBP: 98, diastolicBP: 58, oxygenSat: 99, temperatureF: 99.1 },
        },
        // ESI 5 — non-urgent
        {
            patientId: "P-0012",
            name: "Fatima Hassan",
            age: 29,
            triageLevel: "non_urgent",
            chiefComplaint: "Ran out of blood pressure medication, needs refill",
            status: "waiting",
            arrivalTime: ago(145),
            recommendedBedType: "exam",
            carePathway: "Brief vitals check, prescription renewal",
            vitals: { heartRate: 72, systolicBP: 126, diastolicBP: 80, oxygenSat: 99, temperatureF: 98.3 },
        },
    ].map(p => ({ ...p, createdAt: new Date(), updatedAt: new Date() }));

    // ── BEDS ──────────────────────────────────────────────────────────────────
    // 4 occupied · 3 need cleaning (triggers HIGH priority cleaning actions) · 5 ready
    const beds = [
        { bedId: "B-001", room: "ER-101", type: "trauma",      status: "occupied",  occupiedByPatientId: "P-0003", needsCleaning: false, hasMonitor: true  },
        { bedId: "B-002", room: "ER-102", type: "trauma",      status: "occupied",  occupiedByPatientId: "P-0004", needsCleaning: false, hasMonitor: true  },
        { bedId: "B-003", room: "ER-103", type: "exam",        status: "occupied",  occupiedByPatientId: "P-0007", needsCleaning: false, hasMonitor: true  },
        { bedId: "B-004", room: "ER-104", type: "exam",        status: "occupied",  occupiedByPatientId: "P-0008", needsCleaning: false, hasMonitor: false },
        // Needs cleaning — agent will clean then assign next waiting patient
        { bedId: "B-005", room: "ER-105", type: "trauma",      status: "available", occupiedByPatientId: null, needsCleaning: true,  hasMonitor: true  },
        { bedId: "B-006", room: "ER-106", type: "exam",        status: "available", occupiedByPatientId: null, needsCleaning: true,  hasMonitor: false },
        { bedId: "B-007", room: "ER-107", type: "observation", status: "available", occupiedByPatientId: null, needsCleaning: true,  hasMonitor: true  },
        // Ready beds
        { bedId: "B-008", room: "ER-108", type: "isolation",   status: "available", occupiedByPatientId: null, needsCleaning: false, hasMonitor: true  },
        { bedId: "B-009", room: "ER-109", type: "exam",        status: "available", occupiedByPatientId: null, needsCleaning: false, hasMonitor: false },
        { bedId: "B-010", room: "ER-110", type: "pediatric",   status: "available", occupiedByPatientId: null, needsCleaning: false, hasMonitor: true  },
        { bedId: "B-011", room: "ER-111", type: "exam",        status: "available", occupiedByPatientId: null, needsCleaning: false, hasMonitor: false },
        { bedId: "B-012", room: "ER-112", type: "observation", status: "available", occupiedByPatientId: null, needsCleaning: false, hasMonitor: true  },
    ].map(b => ({ ...b, createdAt: new Date(), updatedAt: new Date() }));

    // ── STAFF ─────────────────────────────────────────────────────────────────
    // Nurse coverage: P-0007 (Marcus) covered by Miguel, P-0008 (Grace) covered by Tina.
    // All ESI 1-2 patients (P-0001, P-0002, P-0003, P-0004) have NO nurse → paging actions.
    // Rachel Green: 10.1h on shift → HIGH shift alert.
    // Miguel Santos: 9.6h on shift → medium shift alert.
    const staff = [
        { staffId: "S-001", name: "Dr. Elena Morris", role: "physician",    available: false, currentAssignment: "P-0003", shift: "day",     shiftStartedAt: hoursAgo(6.5), canPage: false },
        { staffId: "S-002", name: "Dr. James Okafor", role: "physician",    available: false, currentAssignment: "P-0004", shift: "day",     shiftStartedAt: hoursAgo(6.5), canPage: false },
        { staffId: "S-003", name: "Dr. Aisha Khan",   role: "physician",    available: true,  currentAssignment: null,     shift: "evening", shiftStartedAt: hoursAgo(2.0), canPage: false },
        { staffId: "S-004", name: "Rachel Green",     role: "charge_nurse", available: true,  currentAssignment: null,     shift: "day",     shiftStartedAt: hoursAgo(10.1), canPage: true },
        { staffId: "S-005", name: "Miguel Santos",    role: "nurse",        available: false, currentAssignment: "P-0007", shift: "day",     shiftStartedAt: hoursAgo(9.6),  canPage: true },
        { staffId: "S-006", name: "Tina Brooks",      role: "nurse",        available: false, currentAssignment: "P-0008", shift: "day",     shiftStartedAt: hoursAgo(7.0),  canPage: true },
        { staffId: "S-007", name: "Sam Wilson",       role: "nurse",        available: true,  currentAssignment: null,     shift: "evening", shiftStartedAt: hoursAgo(3.0),  canPage: true },
        { staffId: "S-008", name: "Jordan Lee",       role: "nurse",        available: true,  currentAssignment: null,     shift: "evening", shiftStartedAt: hoursAgo(2.5),  canPage: true },
        { staffId: "S-009", name: "Morgan Blake",     role: "paramedic",    available: true,  currentAssignment: null,     shift: "day",     shiftStartedAt: hoursAgo(8.0),  canPage: false },
        { staffId: "S-010", name: "Priya Nair",       role: "tech",         available: true,  currentAssignment: null,     shift: "day",     shiftStartedAt: hoursAgo(9.2),  canPage: false },
    ].map(s => ({ ...s, department: "Emergency", createdAt: new Date(), updatedAt: new Date() }));

    // ── EVENTS ────────────────────────────────────────────────────────────────
    const events = [
        { eventId: "EVT-0001", type: "patient_arrived",  patientId: "P-0001", staffId: null,    bedId: null,    severity: "critical", message: "James Carter (ESI 1) arrived — chest pain with diaphoresis. Cardiac event suspected. Awaiting trauma bed.", timestamp: ago(8)  },
        { eventId: "EVT-0002", type: "patient_arrived",  patientId: "P-0002", staffId: null,    bedId: null,    severity: "critical", message: "Sofia Chen (ESI 2) arrived — chest pain, SpO₂ 91%. Awaiting trauma bed.", timestamp: ago(14) },
        { eventId: "EVT-0003", type: "triage_completed", patientId: "P-0003", staffId: "S-001", bedId: "B-001", severity: "critical", message: "Owen Davis — stroke protocol activated. Stat CT head ordered. Neurology notified.", timestamp: ago(20) },
        { eventId: "EVT-0004", type: "patient_arrived",  patientId: "P-0005", staffId: null,    bedId: null,    severity: "warning",  message: "Mia Johnson (8 y/o) arrived — febrile seizure 20 min ago, temp 104.2°F. Pediatric bed requested.", timestamp: ago(18) },
        { eventId: "EVT-0005", type: "patient_arrived",  patientId: "P-0006", staffId: null,    bedId: null,    severity: "warning",  message: "Noah Patel arrived — anaphylaxis to peanuts. Throat tightening reported. Epinephrine on standby.", timestamp: ago(11) },
        { eventId: "EVT-0006", type: "bed_assigned",     patientId: "P-0004", staffId: "S-002", bedId: "B-002", severity: "info",     message: "Ava Thompson assigned to trauma bed B-002 (ER-102).", timestamp: ago(28) },
        { eventId: "EVT-0007", type: "bed_assigned",     patientId: "P-0007", staffId: null,    bedId: "B-003", severity: "info",     message: "Marcus Rivera assigned to exam bed B-003 (ER-103).", timestamp: ago(46) },
        { eventId: "EVT-0008", type: "nurse_page",       patientId: "P-0007", staffId: "S-005", bedId: "B-003", severity: "info",     message: "Miguel Santos assigned to Marcus Rivera — urgent abdominal pain.", timestamp: ago(45) },
        { eventId: "EVT-0009", type: "bed_assigned",     patientId: "P-0008", staffId: null,    bedId: "B-004", severity: "info",     message: "Grace Miller assigned to exam bed B-004 (ER-104).", timestamp: ago(62) },
        { eventId: "EVT-0010", type: "nurse_page",       patientId: "P-0008", staffId: "S-006", bedId: "B-004", severity: "info",     message: "Tina Brooks assigned to Grace Miller — hip fracture.", timestamp: ago(60) },
    ].map(e => ({ ...e, createdAt: new Date() }));

    // ── SUPPLIES (supporting data — not directly demonstrated) ────────────────
    const supplyList = [
        { name: "Nitrile gloves",       category: "ppe",         quantity: 420, reorderLevel: 100 },
        { name: "Surgical masks",       category: "ppe",         quantity: 280, reorderLevel: 80  },
        { name: "N95 respirators",      category: "ppe",         quantity: 45,  reorderLevel: 50  },
        { name: "IV start kits",        category: "iv",          quantity: 38,  reorderLevel: 30  },
        { name: "Saline bags (1L)",     category: "iv",          quantity: 62,  reorderLevel: 40  },
        { name: "Gauze pads",           category: "wound_care",  quantity: 210, reorderLevel: 60  },
        { name: "Suture kits",          category: "wound_care",  quantity: 22,  reorderLevel: 20  },
        { name: "ECG electrodes",       category: "diagnostic",  quantity: 14,  reorderLevel: 25  },
        { name: "Pulse oximeter probes",category: "diagnostic",  quantity: 9,   reorderLevel: 12  },
        { name: "Epinephrine 0.3mg",    category: "medication",  quantity: 18,  reorderLevel: 15  },
        { name: "Naloxone 0.4mg",       category: "medication",  quantity: 24,  reorderLevel: 20  },
        { name: "Ondansetron 4mg",      category: "medication",  quantity: 55,  reorderLevel: 30  },
        { name: "Oxygen cannulas",      category: "respiratory", quantity: 31,  reorderLevel: 20  },
        { name: "Nebulizer kits",       category: "respiratory", quantity: 8,   reorderLevel: 10  },
        { name: "Glucose test strips",  category: "diagnostic",  quantity: 120, reorderLevel: 40  },
    ];
    const supplies = supplyList.map((s, i) => ({
        supplyId: `SUP-${String(i + 1).padStart(3, "0")}`,
        ...s,
        unit: "each",
        status: s.quantity <= s.reorderLevel ? "low_stock" : "in_stock",
        location: i % 3 === 0 ? "Supply Room A" : i % 3 === 1 ? "Trauma Bay" : "Nurse Station",
        createdAt: new Date(),
        updatedAt: new Date(),
    }));

    await db.collection("patients").insertMany(patients);
    await db.collection("beds").insertMany(beds);
    await db.collection("staff").insertMany(staff);
    await db.collection("supplies").insertMany(supplies);
    await db.collection("events").insertMany(events);

    console.log(`\nSeeded ${DB_NAME}`);
    for (const c of ["patients", "beds", "staff", "supplies", "events"])
        console.log(`  ${c}: ${await db.collection(c).countDocuments()}`);

    await client.close();
}

main().catch(async err => {
    console.error(err);
    await client.close();
    process.exit(1);
});
