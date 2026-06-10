import type {
    OperationsStatus,
    OrchestrateResponse,
    Severity,
} from "./types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiBaseUrl = (configuredApiBaseUrl || "/api").replace(/\/$/, "");

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${apiBaseUrl}${path}`, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                ...init?.headers,
            },
        });
    } catch {
        throw new Error(
            "Cannot reach the Rapid Handoff backend. Start it with `corepack pnpm dev` and confirm it is listening on port 8080.",
        );
    }

    if (!response.ok) {
        const payload = (await response.json().catch(() => undefined)) as
            | { message?: string; error?: string }
            | undefined;
        throw new Error(
            payload?.message ??
                payload?.error ??
                `Request failed with status ${response.status}.`,
        );
    }

    return (await response.json()) as T;
}

export function submitPatientIntake(input: {
    patientId: string;
    age: number;
    chiefComplaint: string;
    symptoms: string[];
    triageLevel: Severity;
}): Promise<OrchestrateResponse> {
    return apiRequest<OrchestrateResponse>("/agent/orchestrate", {
        method: "POST",
        body: JSON.stringify({
            query:
                "Create or update this ER intake, assess triage priority, assign an appropriate available bed and staff, then return a concise operational summary.",
            userId: "receptionist-ui",
            context: {
                patientId: input.patientId,
                age: input.age,
                chiefComplaint: input.chiefComplaint,
                symptoms: input.symptoms,
                triageLevel: input.triageLevel,
                status: "waiting",
                arrivalTime: new Date().toISOString(),
                requiresMonitor:
                    input.triageLevel === "critical" ||
                    input.triageLevel === "emergent",
                assignedByStaffId: "receptionist-ui",
            },
        }),
    });
}

export function fetchOperationsStatus(): Promise<OperationsStatus> {
    return apiRequest<OperationsStatus>("/operations/status");
}

export function fetchBackendHealth(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>("/health");
}
