import "dotenv/config";

import { LlmAgent, type BeforeModelCallback } from "@google/adk";

import {
    staffCoordinationAgentInputSchema,
    staffCoordinationAgentOutputSchema,
} from "./contracts.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export function createStaffCoordinationAgent(options: {
    beforeModelCallback?: BeforeModelCallback;
} = {}) {
    return new LlmAgent({
        name: "staff_coordination_agent",
        model,
        description:
            "Selects the most appropriate available staff and recommends an assignment message.",
        instruction: `You are the Rapid Handoff staff coordination agent.

You receive the assigned bed, routing priority, and a list of currently
available staff. Choose the smallest appropriate team that covers the workflow,
prioritize available physicians and nurses when needed, and draft a concise
operational alert.

Return JSON that matches the schema exactly.
Do not invent unavailable staff members.`,
        inputSchema: staffCoordinationAgentInputSchema,
        outputSchema: staffCoordinationAgentOutputSchema,
        disallowTransferToParent: true,
        disallowTransferToPeers: true,
        beforeModelCallback: options.beforeModelCallback,
    });
}

export const staffCoordinationAgent = createStaffCoordinationAgent();
