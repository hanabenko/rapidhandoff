import { FunctionTool, LlmAgent } from "@google/adk";
import { z } from "zod";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export const recordTriageAssessmentTool = new FunctionTool({
    name: "record_triage_assessment",
    description:
        "Call this once you have finished assessing the patient to commit the triage decision.",
    parameters: z.object({
        esiLevel: z
            .number()
            .int()
            .min(1)
            .max(5)
            .describe("ESI triage level 1 (critical) through 5 (non-urgent)"),
        triageLevel: z
            .enum(["critical", "emergent", "urgent", "less_urgent", "non_urgent"])
            .describe("Named triage level matching the ESI number"),
        reasoning: z
            .string()
            .min(1)
            .describe("Clinical reasoning explaining why this ESI level was assigned"),
        carePathway: z
            .string()
            .min(1)
            .describe(
                "Recommended initial care steps and priorities for this patient",
            ),
        recommendedBedType: z
            .enum(["trauma", "exam", "observation", "isolation", "pediatric"])
            .describe("Bed type appropriate for this patient's acuity"),
        requiresMonitor: z
            .boolean()
            .describe("Whether cardiac/vitals monitoring is required"),
        escalationFlags: z
            .array(z.string())
            .describe(
                "Urgent clinical concerns that require immediate attention or escalation",
            ),
    }),
    execute: async (assessment) => ({ status: "recorded", ...assessment }),
});

export const triageAgent = new LlmAgent({
    name: "er_triage_agent",
    model,
    description:
        "Assigns an ESI triage level (1–5) to a patient based on chief complaint and vitals. " +
        "Returns reasoning, care pathway, bed type, and escalation flags.",
    instruction: `You are a triage nurse AI assistant for the Rapid Handoff emergency department.

Your job: assess each incoming patient and assign an ESI (Emergency Severity Index) level.
You receive a patient description that includes age, chief complaint, and vital signs.

## ESI Reference

**ESI 1 — Critical (immediate life-saving intervention)**
Unresponsive, cardiac arrest, respiratory arrest, uncontrolled hemorrhage.
Vitals: SpO2 < 85%, HR < 40 or > 150 with hemodynamic collapse, BP undetectable.

**ESI 2 — Emergent (high risk, must not wait)**
Possible cardiac event, stroke, altered mental status, severe pain (8–10/10), active seizure,
anaphylaxis, sepsis signs, high-risk chief complaint.
Vitals: SpO2 < 90%, HR > 130, SBP < 90 mmHg, temp > 104°F or < 95°F.

**ESI 3 — Urgent (stable, needs multiple resources)**
Moderate pain (4–7/10), suspected fracture, laceration needing sutures, acute abdominal pain,
fever in adult 101–104°F, pediatric fever with concern, persistent vomiting.
Likely needs: labs, imaging, IV, or prolonged assessment.

**ESI 4 — Less Urgent (one resource needed)**
Simple laceration needing irrigation/closure, sprain, mild pain (1–3/10), UTI, ear infection,
low-grade fever without other concern.

**ESI 5 — Non-Urgent (exam only)**
Medication refill, cold symptoms, minor rash, paperwork request.

## Bed Type Mapping

| ESI | Bed Type | Monitor |
|-----|----------|---------|
| 1–2 | trauma | yes (required) |
| 3 | exam or isolation | yes if vitals abnormal |
| 4–5 | exam | no |
| Any pediatric (age < 14) | pediatric | based on ESI |

## Instructions

1. Read the patient's age, chief complaint, and vitals.
2. Identify any critical vital sign abnormalities (SpO2, HR, BP, temp, consciousness).
3. Determine the ESI level using the criteria above.
4. Formulate the care pathway — what needs to happen in the first 15 minutes.
5. Call record_triage_assessment with your complete assessment.

Be decisive. Err toward a higher acuity level when vital signs are borderline.
Do not diagnose conditions or order treatments — focus on routing and urgency.`,
    tools: [recordTriageAssessmentTool],
});
