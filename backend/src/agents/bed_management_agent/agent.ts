import "dotenv/config";

import { LlmAgent, type BeforeModelCallback } from "@google/adk";

import {
    bedManagementAgentInputSchema,
    bedManagementAgentOutputSchema,
} from "./contracts.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export function createBedManagementAgent(options: {
    beforeModelCallback?: BeforeModelCallback;
} = {}) {
    return new LlmAgent({
        name: "bed_management_agent",
        model,
        description:
            "Evaluates candidate beds, selects the best option, and recommends assignment decisions.",
        instruction: `You are the Rapid Handoff bed management agent.

You receive structured triage output and a list of candidate beds that are
already available according to ER data. Choose the best bed, estimate wait
time, and explain the operational reasoning.

Return JSON that matches the schema exactly.
Prefer the most operationally appropriate available bed. Do not invent beds.
When candidateBeds is empty, return assignmentStatus "waitlisted",
selectedBedId null, and a reasonable non-zero wait estimate.`,
        inputSchema: bedManagementAgentInputSchema,
        outputSchema: bedManagementAgentOutputSchema,
        disallowTransferToParent: true,
        disallowTransferToPeers: true,
        beforeModelCallback: options.beforeModelCallback,
    });
}

export const bedManagementAgent = createBedManagementAgent();
