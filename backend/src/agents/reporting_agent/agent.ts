import "dotenv/config";

import { LlmAgent, type BeforeModelCallback } from "@google/adk";

import {
    reportingAgentInputSchema,
    reportingAgentOutputSchema,
} from "./contracts.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export function createReportingAgent(options: {
    beforeModelCallback?: BeforeModelCallback;
} = {}) {
    return new LlmAgent({
        name: "reporting_agent",
        model,
        description:
            "Generates dashboard-ready workflow summaries and operational status objects.",
        instruction: `You are the Rapid Handoff reporting agent.

You receive structured outputs from triage, bed management, staff coordination,
and current operational summaries. Produce a concise operational summary,
dashboard-ready status object, and critical alerts.

Return JSON that matches the schema exactly.
Avoid unnecessary sensitive detail.`,
        inputSchema: reportingAgentInputSchema,
        outputSchema: reportingAgentOutputSchema,
        disallowTransferToParent: true,
        disallowTransferToPeers: true,
        beforeModelCallback: options.beforeModelCallback,
    });
}

export const reportingAgent = createReportingAgent();
