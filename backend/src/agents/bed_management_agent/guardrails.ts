import type {
    BedManagementAgentInput,
    BedManagementAgentOutput,
} from "./contracts.js";

export interface GuardedBedOutput extends BedManagementAgentOutput {
    appliedRules: string[];
}

export function applyBedGuardrails(
    input: BedManagementAgentInput,
    proposed: BedManagementAgentOutput,
): GuardedBedOutput {
    const eligible = input.candidateBeds
        .filter(
            (bed) =>
                (!input.requiresMonitor || bed.hasMonitor === true) &&
                (bed.type === input.recommendedBedType ||
                    input.routingPriority === "standard_bed"),
        )
        .sort((left, right) => left.bedId.localeCompare(right.bedId));

    if (eligible.length === 0) {
        return {
            ...proposed,
            patientId: input.patientId,
            assignmentStatus: "waitlisted",
            selectedBedId: null,
            selectedBedType: input.recommendedBedType,
            estimatedWaitMinutes: Math.max(
                proposed.estimatedWaitMinutes,
                input.urgency === "immediate" ? 5 : 15,
            ),
            rationale:
                "No candidate satisfies the required bed type and monitoring constraints.",
            appliedRules: ["capacity_waitlist"],
        };
    }

    const proposedBed = eligible.find(
        (bed) => bed.bedId === proposed.selectedBedId,
    );
    const selected = proposedBed ?? eligible[0]!;

    return {
        ...proposed,
        patientId: input.patientId,
        assignmentStatus: "assigned",
        selectedBedId: selected.bedId,
        selectedBedType: selected.type,
        estimatedWaitMinutes: Math.max(0, proposed.estimatedWaitMinutes),
        appliedRules: [
            "available_candidate_only",
            ...(input.requiresMonitor ? ["monitor_required"] : []),
            ...(proposedBed ? [] : ["invalid_selection_replaced"]),
        ],
    };
}
