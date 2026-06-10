export const criticalPatientDemoInput = {
    scenario: "New critical patient has arrived.",
    patient: {
        patientId: "P-DEMO-001",
        symptoms: [
            "severe shortness of breath",
            "chest pain",
            "altered responsiveness",
        ],
        vitals: {
            heartRate: 142,
            systolicBP: 78,
            diastolicBP: 48,
            oxygenSat: 82,
            temperatureF: 99.4,
        },
        age: 68,
        arrivalContext: {
            arrivalMode: "ambulance",
            arrivalTime: "2026-06-07T20:00:00.000Z",
            currentShift: "evening",
        },
    },
} as const;

export const criticalPatientMockData = {
    beds: [
        {
            bedId: "B-TRAUMA-01",
            room: "TRAUMA-1",
            type: "trauma",
            status: "available",
            needsCleaning: false,
            hasMonitor: true,
            version: 4,
        },
        {
            bedId: "B-EXAM-04",
            room: "ER-104",
            type: "exam",
            status: "occupied",
            needsCleaning: false,
            hasMonitor: true,
            version: 8,
        },
        {
            bedId: "B-TRAUMA-02",
            room: "TRAUMA-2",
            type: "trauma",
            status: "available",
            needsCleaning: true,
            hasMonitor: true,
            version: 3,
        },
    ],
    staff: [
        {
            staffId: "S-NURSE-01",
            name: "Rachel Green",
            role: "nurse",
            shift: "evening",
            available: true,
        },
        {
            staffId: "S-PHYS-01",
            name: "Dr. Elena Morris",
            role: "physician",
            shift: "evening",
            available: true,
        },
        {
            staffId: "S-NURSE-02",
            name: "Miguel Santos",
            role: "nurse",
            shift: "evening",
            available: false,
        },
    ],
    supplies: [
        {
            supplyId: "SUP-OXYGEN-01",
            name: "Oxygen cannulas",
            quantity: 24,
            reorderLevel: 8,
        },
        {
            supplyId: "SUP-ECG-01",
            name: "ECG electrodes",
            quantity: 40,
            reorderLevel: 10,
        },
        {
            supplyId: "SUP-IV-01",
            name: "IV start kits",
            quantity: 18,
            reorderLevel: 6,
        },
    ],
    historicalCases: [
        {
            caseId: "CASE-CRIT-001",
            operationalPattern: "shock_signs_with_hypoxia",
            esiLevel: 1,
            carePathway: "resuscitation_critical",
            recommendedResource: "monitored trauma bed",
        },
        {
            caseId: "CASE-CRIT-002",
            operationalPattern: "altered_responsiveness_with_hypotension",
            esiLevel: 1,
            carePathway: "resuscitation_critical",
            recommendedResource: "immediate multidisciplinary response",
        },
    ],
    dashboard: {
        activePatientsBeforeArrival: 17,
        waitingPatientsBeforeArrival: 5,
        averageWaitTimeMinutesBeforeArrival: 42,
        totalBeds: 18,
        occupiedBedsBeforeAssignment: 15,
        scheduledStaff: 14,
        availableStaffBeforeAssignment: 6,
    },
} as const;
