import type {
    TriageAgentInput,
    TriageAgentOutput,
} from "./contracts.js";

const triageToEsi = {
    critical: 1,
    emergent: 2,
    urgent: 3,
    less_urgent: 4,
    non_urgent: 5,
} as const;

export interface GuardedTriageOutput extends TriageAgentOutput {
    esiLevel: 1 | 2 | 3 | 4 | 5;
    appliedRules: string[];
}

export function applyTriageGuardrails(
    input: TriageAgentInput,
    proposed: TriageAgentOutput,
): GuardedTriageOutput {
    const appliedRules: string[] = [];
    let esiLevel = input.reportedTriageLevel
        ? triageToEsi[input.reportedTriageLevel]
        : proposed.severity === "critical"
          ? 1
          : proposed.severity === "high"
            ? 2
            : proposed.severity === "moderate"
              ? 3
              : 4;

    const unstableVitals =
        (input.vitals?.oxygenSat !== undefined &&
            input.vitals.oxygenSat < 90) ||
        (input.vitals?.systolicBP !== undefined &&
            input.vitals.systolicBP < 80) ||
        (input.vitals?.heartRate !== undefined &&
            (input.vitals.heartRate < 40 || input.vitals.heartRate > 150));

    if (unstableVitals) {
        esiLevel = 1;
        appliedRules.push("unstable_vitals_escalation");
    } else if (input.requiresMonitor && esiLevel > 2) {
        esiLevel = 2;
        appliedRules.push("monitoring_requirement_escalation");
    } else {
        appliedRules.push("reported_acuity_mapping");
    }

    const constrained =
        esiLevel === 1
            ? {
                  severity: "critical" as const,
                  urgency: "immediate" as const,
                  routingPriority: "resuscitation" as const,
                  recommendedBedType: "trauma" as const,
                  requiresMonitor: true,
              }
            : esiLevel === 2
              ? {
                    severity: "high" as const,
                    urgency: "expedited" as const,
                    routingPriority: "monitored_bed" as const,
                    recommendedBedType:
                        input.requestedBedType ?? proposed.recommendedBedType,
                    requiresMonitor: true,
                }
              : esiLevel === 3
                ? {
                      severity: "moderate" as const,
                      urgency: "standard" as const,
                      routingPriority: "standard_bed" as const,
                      recommendedBedType:
                          input.requestedBedType ?? proposed.recommendedBedType,
                      requiresMonitor: input.requiresMonitor ?? false,
                  }
                : {
                      severity: "low" as const,
                      urgency: "standard" as const,
                      routingPriority: "fast_track" as const,
                      recommendedBedType:
                          input.requestedBedType ?? proposed.recommendedBedType,
                      requiresMonitor: input.requiresMonitor ?? false,
                  };

    return {
        ...proposed,
        ...constrained,
        patientId: input.patientId,
        esiLevel,
        appliedRules,
    };
}
