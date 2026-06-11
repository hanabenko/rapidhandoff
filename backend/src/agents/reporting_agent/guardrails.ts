import type {
    ReportingAgentInput,
    ReportingAgentOutput,
} from "./contracts.js";

export interface GuardedReportingOutput extends ReportingAgentOutput {
    appliedRules: string[];
}

export function applyReportingGuardrails(
    input: ReportingAgentInput,
    proposed: ReportingAgentOutput,
): GuardedReportingOutput {
    const alerts = new Set(proposed.criticalAlerts);
    if (input.bedAssignment.assignmentStatus === "waitlisted") {
        alerts.add("No eligible bed is currently available.");
    }
    if (input.staffAssignment.assignmentStatus === "deferred") {
        alerts.add("Staff assignment is pending operational capacity.");
    }

    return {
        ...proposed,
        patientId: input.patientId,
        dashboardStatus: {
            patientId: input.patientId,
            triageSeverity: input.triage.severity,
            routingPriority: input.triage.routingPriority,
            bedId: input.bedAssignment.selectedBedId,
            assignedStaffIds: input.staffAssignment.assignedStaffIds,
            estimatedWaitMinutes:
                input.bedAssignment.estimatedWaitMinutes,
        },
        criticalAlerts: [...alerts].slice(0, 10),
        appliedRules: ["upstream_state_is_source_of_truth", "capacity_alerts"],
    };
}
