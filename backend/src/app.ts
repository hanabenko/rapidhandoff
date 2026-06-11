import path from "path";
import { fileURLToPath } from "url";
import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { z } from "zod";

import {
    analyzeBedCapacityTool,
    detectBottlenecksTool,
    generateShiftBriefingTool,
    getErCensusSummaryTool,
    recommendStaffingTool,
} from "./agents/orchestrator_agent/tools.js";
import { loadErSnapshot } from "./agents/orchestrator_agent/data.js";
import { orchestrateErOperations, streamErOperations } from "./orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIAGE_ORDER: Record<string, number> = {
    critical: 1,
    emergent: 2,
    urgent: 3,
    less_urgent: 4,
    non_urgent: 5,
};

function minutesSince(input: Date | string, now: Date) {
    return Math.max(
        0,
        Math.round((now.getTime() - new Date(input).getTime()) / 60_000),
    );
}

function hoursSince(input: Date | string, now: Date) {
    return Number((minutesSince(input, now) / 60).toFixed(1));
}

function titleCase(value: string) {
    return value
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

const orchestrateRequestSchema = z.object({
    query: z.string().trim().min(1).max(10_000),
    context: z
        .union([z.string().max(20_000), z.record(z.string(), z.unknown())])
        .optional(),
    userId: z.string().trim().min(1).max(200).optional(),
});

const directTools = {
    census: getErCensusSummaryTool,
    bottlenecks: detectBottlenecksTool,
    staffing: recommendStaffingTool,
    beds: analyzeBedCapacityTool,
    briefing: generateShiftBriefingTool,
} as const;

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "64kb" }));
    app.use(express.static(path.join(__dirname, "../../frontend")));

    app.get("/", (_request, response) => {
        response.json({
            ok: true,
            service: "rapid-handoff-er-orchestrator",
        });
    });

    app.get("/health", (_request, response) => {
        response.json({ ok: true });
    });

    app.get(
        "/api/er-status",
        async (_request: Request, response: Response, next: NextFunction) => {
            try {
                const snapshot = await loadErSnapshot();
                const now = snapshot.capturedAt;
                const roomByPatientId = new Map(
                    snapshot.beds
                        .filter((bed) => Boolean(bed.occupiedByPatientId))
                        .map((bed) => [bed.occupiedByPatientId!, bed.room ?? bed.bedId]),
                );

                const waiting = snapshot.patients
                    .filter(
                        (patient) =>
                            patient.status === "waiting" ||
                            patient.status === "in_treatment",
                    )
                    .sort((a, b) => {
                        const ao = TRIAGE_ORDER[a.triageLevel] ?? 99;
                        const bo = TRIAGE_ORDER[b.triageLevel] ?? 99;
                        if (ao !== bo) return ao - bo;
                        return (
                            new Date(a.arrivalTime).getTime() -
                            new Date(b.arrivalTime).getTime()
                        );
                    })
                    .map((patient, index) => ({
                        position: index + 1,
                        patientId: patient.patientId,
                        name: patient.name ?? "-",
                        age: patient.age ?? null,
                        triageLevel: patient.triageLevel,
                        status: patient.status,
                        arrivalTime: patient.arrivalTime,
                        chiefComplaint: patient.chiefComplaint ?? null,
                        room: roomByPatientId.get(patient.patientId) ?? null,
                    }));

                const bedsAvailable = snapshot.beds.filter(
                    (bed) => bed.status === "available" && !bed.needsCleaning,
                ).length;
                const bedsOccupied = snapshot.beds.filter(
                    (bed) => bed.status === "occupied",
                ).length;
                const bedsAwaitingCleaning = snapshot.beds.filter(
                    (bed) => bed.status === "available" && bed.needsCleaning,
                ).length;
                const staffOnDuty = snapshot.staff.length;
                const pageReadyNurses = snapshot.staff.filter(
                    (staff) =>
                        (staff.role === "nurse" ||
                            staff.role === "charge_nurse") &&
                        staff.available &&
                        staff.canPage !== false,
                ).length;
                const nurseAssignments = new Set(
                    snapshot.staff
                        .filter(
                            (staff) =>
                                (staff.role === "nurse" ||
                                    staff.role === "charge_nurse") &&
                                Boolean(staff.currentAssignment),
                        )
                        .map((staff) => staff.currentAssignment),
                );
                const uncoveredPatientsNeedingNurse = snapshot.patients
                    .filter(
                        (patient) =>
                            (patient.status === "waiting" ||
                                patient.status === "in_treatment") &&
                            (TRIAGE_ORDER[patient.triageLevel] ?? 99) <= 3 &&
                            !nurseAssignments.has(patient.patientId),
                    )
                    .slice(0, 4);
                const roomsToClean = snapshot.beds
                    .filter((bed) => bed.status === "available" && bed.needsCleaning)
                    .slice(0, 4)
                    .map((bed) => ({
                        bedId: bed.bedId,
                        room: bed.room ?? bed.bedId,
                        type: bed.type,
                    }));
                const nurseShiftAlerts = snapshot.staff
                    .filter(
                        (staff) =>
                            (staff.role === "nurse" ||
                                staff.role === "charge_nurse") &&
                            staff.shiftStartedAt,
                    )
                    .map((staff) => ({
                        staffId: staff.staffId,
                        name: staff.name ?? staff.staffId,
                        role: staff.role,
                        shift: staff.shift,
                        hoursOnShift: hoursSince(staff.shiftStartedAt!, now),
                    }))
                    .filter((staff) => staff.hoursOnShift >= 9.5)
                    .sort((a, b) => b.hoursOnShift - a.hoursOnShift);

                const nextActions = [
                    ...roomsToClean.map((bed) => ({
                        priority: bedsAwaitingCleaning >= 3 ? "high" : "medium",
                        category: "cleaning",
                        title: `Clean room ${bed.room}`,
                        detail: `${titleCase(bed.type)} bed ${bed.bedId} is ready for turnover but blocked by cleaning.`,
                    })),
                    ...uncoveredPatientsNeedingNurse.map((patient) => ({
                        priority:
                            (TRIAGE_ORDER[patient.triageLevel] ?? 99) <= 2
                                ? "high"
                                : "medium",
                        category: "paging",
                        title: `Page a nurse for ${patient.name ?? patient.patientId}`,
                        detail: `${patient.chiefComplaint ?? "Patient needs assessment"}${roomByPatientId.get(patient.patientId) ? ` in room ${roomByPatientId.get(patient.patientId)}` : " in the queue"} with ${titleCase(patient.triageLevel)} priority.`,
                    })),
                    ...nurseShiftAlerts.slice(0, 4).map((staff) => ({
                        priority: staff.hoursOnShift >= 10 ? "high" : "medium",
                        category: "shift",
                        title: `${staff.name} is nearing 10 hours`,
                        detail: `${staff.name} has been on shift for ${staff.hoursOnShift} hours (${titleCase(staff.role)} / ${staff.shift}).`,
                    })),
                ].slice(0, 8);

                const alerts = [
                    ...snapshot.events
                        .filter((event) => event.severity === "critical")
                        .slice(0, 4)
                        .map((event) => ({
                            severity: "critical",
                            message: event.message,
                            timestamp: event.timestamp,
                        })),
                    ...nurseShiftAlerts
                        .filter((staff) => staff.hoursOnShift >= 10)
                        .slice(0, 3)
                        .map((staff) => ({
                            severity: "warning",
                            message: `${staff.name} is at ${staff.hoursOnShift} hours on shift.`,
                            timestamp: now,
                        })),
                    ...(bedsAwaitingCleaning > 0
                        ? [
                              {
                                  severity:
                                      bedsAwaitingCleaning >= 3 ? "warning" : "info",
                                  message: `${bedsAwaitingCleaning} room${bedsAwaitingCleaning === 1 ? "" : "s"} awaiting cleaning are reducing ready bed capacity.`,
                                  timestamp: now,
                              },
                          ]
                        : []),
                ].slice(0, 8);

                response.json({
                    capturedAt: snapshot.capturedAt,
                    waiting,
                    operations: {
                        roomsToClean,
                        uncoveredPatientsNeedingNurse: uncoveredPatientsNeedingNurse.map(
                            (patient) => ({
                                patientId: patient.patientId,
                                name: patient.name ?? patient.patientId,
                                triageLevel: patient.triageLevel,
                                room: roomByPatientId.get(patient.patientId) ?? null,
                            }),
                        ),
                        nurseShiftAlerts,
                        nextActions,
                        alerts,
                    },
                    stats: {
                        waitingCount: waiting.filter(
                            (patient) => patient.status === "waiting",
                        ).length,
                        inTreatmentCount: waiting.filter(
                            (patient) => patient.status === "in_treatment",
                        ).length,
                        bedsAvailable,
                        bedsOccupied,
                        bedsAwaitingCleaning,
                        totalBeds: snapshot.beds.length,
                        staffOnDuty,
                        pageReadyNurses,
                    },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    app.post(
        "/agent/orchestrate",
        async (request: Request, response: Response, next: NextFunction) => {
            try {
                const input = orchestrateRequestSchema.parse(request.body);
                response.json(await orchestrateErOperations(input));
            } catch (error) {
                next(error);
            }
        },
    );

    app.post(
        "/agent/orchestrate/stream",
        async (request: Request, response: Response, next: NextFunction) => {
            try {
                const input = orchestrateRequestSchema.parse(request.body);
                response.setHeader("Content-Type", "text/event-stream");
                response.setHeader("Cache-Control", "no-cache");
                response.setHeader("Connection", "keep-alive");
                response.flushHeaders();

                const send = (data: object) =>
                    response.write(`data: ${JSON.stringify(data)}\n\n`);

                try {
                    const finalResponse = await streamErOperations(input, send);
                    send({ type: "done", response: finalResponse });
                } catch (streamErr) {
                    send({
                        type: "error",
                        message: streamErr instanceof Error ? streamErr.message : "Unexpected error",
                    });
                }
                response.end();
            } catch (error) {
                next(error);
            }
        },
    );

    for (const [route, tool] of Object.entries(directTools)) {
        app.post(
            `/tools/${route}`,
            async (request: Request, response: Response, next: NextFunction) => {
                try {
                    const result = await tool.runAsync({
                        args: request.body ?? {},
                        toolContext: undefined as never,
                    });
                    response.json(result);
                } catch (error) {
                    next(error);
                }
            },
        );
    }

    app.use(
        (
            error: unknown,
            _request: Request,
            response: Response,
            _next: NextFunction,
        ) => {
            if (error instanceof z.ZodError) {
                response.status(400).json({
                    error: "invalid_request",
                    details: error.issues,
                });
                return;
            }

            console.error(error);
            response.status(500).json({
                error: "internal_error",
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
            });
        },
    );

    return app;
}
