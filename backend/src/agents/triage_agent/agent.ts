import "dotenv/config";

import { LlmAgent, type BeforeModelCallback } from "@google/adk";

import {
    triageAgentInputSchema,
    triageAgentOutputSchema,
} from "./contracts.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export function createTriageAgent(options: {
    beforeModelCallback?: BeforeModelCallback;
} = {}) {
    return new LlmAgent({
        name: "triage_agent",
        model,
        description:
            "Assesses severity, determines urgency, and recommends routing priority for ER intake.",
        instruction: `You are the Rapid Handoff triage agent.

You receive structured ER intake context. Your job is to produce an operational
triage recommendation only.

Return JSON that matches the schema exactly.
Do not diagnose disease, prescribe treatment, or add patient-identifying detail
that was not already provided in the structured input.
Choose the routing priority and recommended bed type that best support ER flow.`,
        inputSchema: triageAgentInputSchema,
        outputSchema: triageAgentOutputSchema,
        disallowTransferToParent: true,
        disallowTransferToPeers: true,
        beforeModelCallback: options.beforeModelCallback,
    });
}

export const triageAgent = createTriageAgent();
