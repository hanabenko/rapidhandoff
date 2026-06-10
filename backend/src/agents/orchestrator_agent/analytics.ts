import {
    type ErEvent,
    type ErSnapshot,
    type Patient,
    type StaffMember,
} from "./data.js";

const ACTIVE_STATUSES = new Set(["waiting", "in_treatment", "admitted"]);
const HIGH_ACUITY = new Set(["critical", "emergent"]);
const TRIAGE_ORDER = [
    "critical",
    "emergent",
    "urgent",
    "less_urgent",
    "non_urgent",
] as const;
export const SHIFT_VALUES = ["day", "evening", "night"] as const;

function minutesSince(date: Date, now: Date): number {
    return Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
    return items.reduce<Record<string, number>>((counts, item) => {
        const value = key(item);
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
    }, {});
}

function percentage(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function activePatients(snapshot: ErSnapshot): Patient[] {
    return snapshot.patients.filter((patient) =>
        ACTIVE_STATUSES.has(patient.status),
    );
}

export function buildCensusSummary(
    snapshot: ErSnapshot,
    longWaitMinutes = 120,
) {
    const active = activePatients(snapshot);
    const waiting = active.filter((patient) => patient.status === "waiting");
    const waits = waiting.map((patient) =>
        minutesSince(patient.arrivalTime, snapshot.capturedAt),
    );

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        totalPatients: snapshot.patients.length,
        activePatients: active.length,
        byStatus: countBy(snapshot.patients, (patient) => patient.status),
        byTriageLevel: Object.fromEntries(
            TRIAGE_ORDER.map((level) => [
                level,
                active.filter((patient) => patient.triageLevel === level).length,
            ]),
        ),
        waiting: {
            count: waiting.length,
            averageWaitMinutes:
                waits.length === 0
                    ? 0
                    : Math.round(
                          waits.reduce((total, wait) => total + wait, 0) /
                              waits.length,
                      ),
            longestWaitMinutes: waits.length === 0 ? 0 : Math.max(...waits),
            overThreshold: waits.filter((wait) => wait >= longWaitMinutes).length,
            thresholdMinutes: longWaitMinutes,
        },
        highAcuityActive: active.filter((patient) =>
            patient.triageLevel
                ? HIGH_ACUITY.has(patient.triageLevel)
                : false,
        ).length,
    };
}

export function buildBedCapacityAnalysis(snapshot: ErSnapshot) {
    const beds = snapshot.beds;
    const occupied = beds.filter((bed) => bed.status === "occupied");
    const cleaning = beds.filter(
        (bed) => bed.status === "available" && bed.needsCleaning,
    );
    const ready = beds.filter(
        (bed) => bed.status === "available" && !bed.needsCleaning,
    );
    const types = [...new Set(beds.map((bed) => bed.type))].sort();

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        totalBeds: beds.length,
        occupiedBeds: occupied.length,
        readyBeds: ready.length,
        bedsAwaitingCleaning: cleaning.length,
        occupancyPercent: percentage(occupied.length, beds.length),
        byType: Object.fromEntries(
            types.map((type) => {
                const matching = beds.filter((bed) => bed.type === type);
                return [
                    type,
                    {
                        total: matching.length,
                        occupied: matching.filter(
                            (bed) => bed.status === "occupied",
                        ).length,
                        ready: matching.filter(
                            (bed) =>
                                bed.status === "available" && !bed.needsCleaning,
                        ).length,
                        awaitingCleaning: matching.filter(
                            (bed) =>
                                bed.status === "available" && bed.needsCleaning,
                        ).length,
                    },
                ];
            }),
        ),
    };
}

export function buildBottleneckAnalysis(
    snapshot: ErSnapshot,
    waitThresholdMinutes = 120,
) {
    const census = buildCensusSummary(snapshot, waitThresholdMinutes);
    const capacity = buildBedCapacityAnalysis(snapshot);
    const active = activePatients(snapshot);
    const waitingForBed = snapshot.patients.filter(
        (patient) => patient.status === "admitted",
    ).length;
    const availableStaff = snapshot.staff.filter((member) => member.available);
    const bottlenecks: Array<{
        area: string;
        severity: "low" | "medium" | "high";
        evidence: string;
        action: string;
    }> = [];

    if (census.waiting.overThreshold > 0) {
        bottlenecks.push({
            area: "waiting_room",
            severity: census.waiting.overThreshold >= 3 ? "high" : "medium",
            evidence: `${census.waiting.overThreshold} patients have waited at least ${waitThresholdMinutes} minutes.`,
            action: "Run a rapid queue review and prioritize by acuity and wait time.",
        });
    }

    if (capacity.occupancyPercent >= 85 || capacity.readyBeds === 0) {
        bottlenecks.push({
            area: "bed_capacity",
            severity:
                capacity.occupancyPercent >= 95 || capacity.readyBeds === 0
                    ? "high"
                    : "medium",
            evidence: `${capacity.occupancyPercent}% occupancy with ${capacity.readyBeds} ready beds.`,
            action: "Escalate discharge, transfer, and bed-turnover coordination.",
        });
    }

    if (capacity.bedsAwaitingCleaning > 0) {
        bottlenecks.push({
            area: "bed_turnover",
            severity:
                capacity.bedsAwaitingCleaning >= Math.max(2, capacity.readyBeds)
                    ? "high"
                    : "medium",
            evidence: `${capacity.bedsAwaitingCleaning} available beds are blocked by cleaning.`,
            action: "Prioritize environmental services turnover for blocked beds.",
        });
    }

    if (waitingForBed > 0) {
        bottlenecks.push({
            area: "admission_boarding",
            severity: waitingForBed >= 3 ? "high" : "medium",
            evidence: `${waitingForBed} admitted patients remain in the ER.`,
            action: "Coordinate inpatient placement and review discharge-ready patients.",
        });
    }

    const activePerAvailableStaff =
        availableStaff.length === 0
            ? active.length
            : Number((active.length / availableStaff.length).toFixed(1));
    if (availableStaff.length === 0 || activePerAvailableStaff > 4) {
        bottlenecks.push({
            area: "staff_coverage",
            severity: availableStaff.length === 0 ? "high" : "medium",
            evidence: `${active.length} active patients for ${availableStaff.length} available staff (${activePerAvailableStaff} per available staff member).`,
            action: "Rebalance assignments and call in qualified coverage if sustained.",
        });
    }

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        overallSeverity: bottlenecks.some((item) => item.severity === "high")
            ? "high"
            : bottlenecks.length > 0
              ? "medium"
              : "low",
        bottlenecks,
        metrics: {
            activePatients: active.length,
            longWaitingPatients: census.waiting.overThreshold,
            occupancyPercent: capacity.occupancyPercent,
            readyBeds: capacity.readyBeds,
            admittedPatientsInEr: waitingForBed,
            availableStaff: availableStaff.length,
            activePatientsPerAvailableStaff: activePerAvailableStaff,
        },
    };
}

type Shift = (typeof SHIFT_VALUES)[number];

export function buildStaffingRecommendation(
    snapshot: ErSnapshot,
    shift?: Shift,
) {
    const relevantStaff = shift
        ? snapshot.staff.filter((member) => member.shift === shift)
        : snapshot.staff;
    const active = activePatients(snapshot);
    const highAcuity = active.filter((patient) =>
        patient.triageLevel
            ? HIGH_ACUITY.has(patient.triageLevel)
            : false,
    ).length;
    const waiting = active.filter((patient) => patient.status === "waiting").length;
    const byRole = countBy(relevantStaff, (member) => member.role);
    const availableByRole = countBy(
        relevantStaff.filter((member) => member.available),
        (member: StaffMember) => member.role,
    );

    const targetNurses = Math.max(1, Math.ceil(active.length / 4));
    const targetPhysicians = Math.max(1, Math.ceil(active.length / 10));
    const targetTechs = active.length >= 12 ? 2 : active.length > 0 ? 1 : 0;
    const availableNurses =
        (availableByRole.nurse ?? 0) + (availableByRole.charge_nurse ?? 0);
    const recommendations: string[] = [];

    if (availableNurses < targetNurses) {
        recommendations.push(
            `Add ${targetNurses - availableNurses} nurse-equivalent coverage based on a planning ratio of 1:4 active patients.`,
        );
    }
    if ((availableByRole.physician ?? 0) < targetPhysicians) {
        recommendations.push(
            `Add ${targetPhysicians - (availableByRole.physician ?? 0)} physician based on a planning ratio of 1:10 active patients.`,
        );
    }
    if ((availableByRole.tech ?? 0) < targetTechs) {
        recommendations.push(
            `Add ${targetTechs - (availableByRole.tech ?? 0)} technician coverage.`,
        );
    }
    if (highAcuity > 0 && availableNurses === 0) {
        recommendations.unshift(
            "Immediately assign qualified nursing coverage to high-acuity patients.",
        );
    }
    if (waiting >= 5) {
        recommendations.push(
            "Dedicate a clinician or rapid-assessment team to the waiting queue.",
        );
    }
    if (recommendations.length === 0) {
        recommendations.push(
            "Current headcount meets the configured planning ratios; continue monitoring workload and skill mix.",
        );
    }

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        shift: shift ?? "all",
        workload: {
            activePatients: active.length,
            highAcuityPatients: highAcuity,
            waitingPatients: waiting,
        },
        scheduledByRole: byRole,
        availableByRole,
        planningTargets: {
            nurseEquivalent: targetNurses,
            physician: targetPhysicians,
            technician: targetTechs,
        },
        recommendations,
        disclaimer:
            "Planning guidance only. Charge leadership must validate assignments, credentials, breaks, and local staffing policy.",
    };
}

export function buildShiftBriefing(
    snapshot: ErSnapshot,
    shift?: Shift,
    lookbackMinutes = 240,
) {
    const cutoff = new Date(
        snapshot.capturedAt.getTime() - lookbackMinutes * 60_000,
    );
    const recentEvents = snapshot.events.filter(
        (event: ErEvent) => event.timestamp >= cutoff,
    );

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        shift: shift ?? "current",
        census: buildCensusSummary(snapshot),
        capacity: buildBedCapacityAnalysis(snapshot),
        flow: buildBottleneckAnalysis(snapshot),
        staffing: buildStaffingRecommendation(snapshot, shift),
        recentEvents: {
            lookbackMinutes,
            total: recentEvents.length,
            critical: recentEvents
                .filter((event) => event.severity === "critical")
                .slice(0, 10)
                .map((event) => ({
                    eventId: event.eventId,
                    type: event.type,
                    message: event.message,
                    timestamp: event.timestamp.toISOString(),
                })),
            byType: countBy(recentEvents, (event) => event.type),
        },
        handoffChecklist: [
            "Confirm ownership of high-acuity and longest-waiting patients.",
            "Review admitted patients awaiting inpatient placement.",
            "Assign bed-turnover priorities.",
            "Validate staffing assignments, breaks, and escalation coverage.",
        ],
    };
}

export type { ErSnapshot };
