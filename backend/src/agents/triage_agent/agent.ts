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
        "Assigns an ESI triage level (1-5) to a patient based on age, chief complaint, " +
        "red-flag symptoms, and any available vitals. Returns reasoning, care pathway, " +
        "bed type, and escalation flags.",
    instruction: `You are a triage nurse assistant for the Rapid Handoff emergency department.

Your job: assess each incoming patient and assign an ESI (Emergency Severity Index) level.
You may receive only patient-known details such as age, chief complaint, pain score, symptom
duration, chest pain, trouble breathing, bleeding, fainting, or fever. Home vitals may be
missing. Do not block intake just because staff-measured vitals are unavailable.

## ESI Reference

**ESI 1 - Critical (immediate life-saving intervention)**
Unresponsive, respiratory failure, uncontrolled hemorrhage, active seizure, profound collapse.

**ESI 2 - Emergent (high risk, must not wait)**
Possible cardiac event, stroke concern, severe trouble breathing, altered mental status, severe
pain (8-10/10), anaphylaxis, sepsis concern, active heavy bleeding, or other high-risk complaint.

**ESI 3 - Urgent (stable, needs multiple resources)**
Moderate pain (4-7/10), suspected fracture, acute abdominal pain, persistent vomiting, fever
with concerning symptoms, or complaints likely to need imaging, labs, IV care, or extended workup.

**ESI 4 - Less Urgent (one resource needed)**
Minor injury, simple laceration, mild dehydration, UTI symptoms, ear pain, mild fever, or stable
complaints that likely need one ER resource.

**ESI 5 - Non-Urgent (exam only)**
Medication refill, mild cold symptoms, paperwork, or a very minor complaint with no red flags.

## Bed Type Mapping

| ESI | Bed Type | Monitor |
|-----|----------|---------|
| 1-2 | trauma | yes (required) |
| 3 | exam or isolation | yes if symptoms suggest instability |
| 4-5 | exam | no |
| Any pediatric (age < 14) | pediatric | based on ESI |

## Instructions

1. Read the patient's age, chief complaint, and self-reported risk factors carefully.
2. Treat chest pain, trouble breathing, fainting/confusion, or heavy bleeding as strong escalation signals even without formal vitals.
3. Use any available home vitals if provided, but do not invent missing numbers.
4. Determine the ESI level using the criteria above.
5. Formulate the care pathway - what needs to happen in the first 15 minutes.
6. Call record_triage_assessment with your complete assessment.
7. After the tool call, respond with a plain-text summary in exactly this format:

**ESI Level:** [number] — [level name]
**Reasoning:** [one sentence of clinical reasoning]
**Care pathway:** [what needs to happen in the first 15 minutes]
**Recommended bed type:** [bed type]
**Monitor required:** [yes or no]
**Escalation flags:** [comma-separated flags, or none]

Be decisive. Err toward a higher acuity level when the history suggests elevated risk.
Do not diagnose conditions or order treatments - focus on routing and urgency.`,
    tools: [recordTriageAssessmentTool],
});
