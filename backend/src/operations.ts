import {
    getMongoErRepository,
    type MongoErRepository,
} from "./agents/orchestrator_agent/data.js";

export interface OperationsStatus {
    capturedAt: string;
    activeQueue: Array<{
        patientId: string;
        triageLevel?: string;
        status: string;
        arrivalTime: string;
        assignedBedId?: string;
        assignedStaffIds: string[];
    }>;
    beds: Array<{
        bedId: string;
        room?: string;
        type: string;
        status: "occupied" | "available";
        needsCleaning: boolean;
        hasMonitor?: boolean;
    }>;
    staff: Array<{
        staffId: string;
        name?: string;
        role: string;
        available: boolean;
        currentAssignment: string | null;
        shift: string;
    }>;
}

export async function getOperationsStatus(
    repository: Pick<MongoErRepository, "loadSnapshot"> = getMongoErRepository(),
): Promise<OperationsStatus> {
    const snapshot = await repository.loadSnapshot();

    return {
        capturedAt: snapshot.capturedAt.toISOString(),
        activeQueue: snapshot.patients
            .filter(
                (patient) =>
                    patient.status === "waiting" ||
                    patient.status === "in_treatment",
            )
            .sort(
                (left, right) =>
                    right.arrivalTime.getTime() - left.arrivalTime.getTime(),
            )
            .map((patient) => ({
                patientId: patient.patientId,
                triageLevel: patient.triageLevel,
                status: patient.status,
                arrivalTime: patient.arrivalTime.toISOString(),
                assignedBedId: patient.assignedBedId,
                assignedStaffIds: patient.assignedStaffIds ?? [],
            })),
        beds: snapshot.beds.map((bed) => ({
            bedId: bed.bedId,
            room: bed.room,
            type: bed.type,
            status: bed.status,
            needsCleaning: bed.needsCleaning,
            hasMonitor: bed.hasMonitor,
        })),
        staff: snapshot.staff.map((staff) => ({
            staffId: staff.staffId,
            name: staff.name,
            role: staff.role,
            available: staff.available,
            currentAssignment: staff.currentAssignment,
            shift: staff.shift,
        })),
    };
}
