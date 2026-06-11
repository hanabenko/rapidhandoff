export type Severity =
    | "critical"
    | "emergent"
    | "urgent"
    | "less_urgent"
    | "non_urgent";

export interface TriageDecision {
    patientId: string;
    severity: "critical" | "high" | "moderate" | "low";
    urgency: "immediate" | "expedited" | "standard";
    routingPriority:
        | "resuscitation"
        | "trauma_bay"
        | "monitored_bed"
        | "standard_bed"
        | "fast_track";
    recommendedBedType: string;
    requiresMonitor: boolean;
    rationale: string;
}

export interface BedAssignment {
    patientId: string;
    assignmentStatus: "assigned" | "waitlisted";
    selectedBedId: string | null;
    selectedBedType: string;
    rationale: string;
    estimatedWaitMinutes: number;
}

export interface StaffAssignment {
    patientId: string;
    assignmentStatus: "assigned" | "deferred";
    assignedStaffIds: string[];
    assignedRoles: string[];
    alertMessage: string;
    rationale: string;
}

export interface ReportingSummary {
    patientId: string;
    operationalSummary: string;
    dashboardStatus: {
        patientId: string;
        triageSeverity: string;
        routingPriority: string;
        bedId: string | null;
        assignedStaffIds: string[];
        estimatedWaitMinutes: number;
    };
    criticalAlerts: string[];
}

export interface OrchestrateResponse {
    agent: string;
    response: string;
    workflowId?: string;
    traceId?: string;
    agentTimeline?: Array<{
        order: number;
        agent: string;
        status: "completed" | "waitlisted" | "deferred";
        inputSummary: string;
        outputSummary: string;
        appliedRules: string[];
        toolActions: Array<{
            tool: string;
            status: string;
        }>;
    }>;
    executionEvidence?: {
        patientRecordId: string;
        patientWriteStatus: string;
        bedAssignmentStatus: string;
        staffAssignmentStatus: string;
        workflowId: string;
        traceId?: string;
    };
    workflow?: {
        triage: TriageDecision;
        bedAssignment: BedAssignment;
        staffAssignment: StaffAssignment;
        reporting: ReportingSummary;
    };
    toolCalls: Array<{
        name?: string;
        args?: Record<string, unknown>;
    }>;
}

export interface OperationsStatus {
    capturedAt: string;
    activeQueue: Array<{
        patientId: string;
        triageLevel?: Severity;
        status: "waiting" | "in_treatment";
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
