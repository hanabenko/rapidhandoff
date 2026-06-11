import type {
    StaffCoordinationAgentInput,
    StaffCoordinationAgentOutput,
} from "./contracts.js";

export interface GuardedStaffOutput extends StaffCoordinationAgentOutput {
    appliedRules: string[];
}

export function applyStaffGuardrails(
    input: StaffCoordinationAgentInput,
    proposed: StaffCoordinationAgentOutput,
): GuardedStaffOutput {
    const available = input.candidateStaff.filter((member) => member.available);
    const specialtyMatched =
        input.preferredSpecialties.length > 0 &&
        available.some(
            (member) =>
                member.specialty &&
                input.preferredSpecialties.includes(member.specialty),
        )
            ? available.filter(
                  (member) =>
                      member.specialty &&
                      input.preferredSpecialties.includes(member.specialty),
              )
            : available;
    const byId = new Map(available.map((member) => [member.staffId, member]));
    const selected = proposed.assignedStaffIds
        .map((staffId) => byId.get(staffId))
        .filter((member) => member !== undefined);
    const requiredRoles =
        input.severity === "critical" || input.severity === "high"
            ? ["physician", "nurse"]
            : ["nurse"];

    for (const role of requiredRoles) {
        if (!selected.some((member) => member.role === role)) {
            const candidate =
                specialtyMatched.find((member) => member.role === role) ??
                available.find((member) => member.role === role);
            if (candidate) {
                selected.push(candidate);
            }
        }
    }

    const unique = [
        ...new Map(selected.map((member) => [member.staffId, member])).values(),
    ].slice(0, 5);

    if (unique.length === 0) {
        return {
            ...proposed,
            patientId: input.patientId,
            assignmentStatus: "deferred",
            assignedStaffIds: [],
            assignedRoles: [],
            alertMessage: `Staff assignment for ${input.assignedBedId} requires charge review.`,
            rationale: "No available candidate satisfies the required roles.",
            appliedRules: ["availability_required", "role_coverage_unavailable"],
        };
    }

    return {
        ...proposed,
        patientId: input.patientId,
        assignmentStatus: "assigned",
        assignedStaffIds: unique.map((member) => member.staffId),
        assignedRoles: unique.map((member) => member.role),
        appliedRules: [
            "availability_required",
            "minimum_role_coverage",
            ...(input.preferredSpecialties.length > 0
                ? ["specialty_preference"]
                : []),
            ...(input.preferredShift ? ["preferred_shift_considered"] : []),
        ],
    };
}
