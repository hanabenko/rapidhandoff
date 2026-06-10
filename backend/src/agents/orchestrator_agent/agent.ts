import "dotenv/config";

import { AgentTool, LlmAgent, type BeforeModelCallback } from "@google/adk";

import {
    bedManagementAgent,
    createBedManagementAgent,
} from "../bed_management_agent/agent.js";
import {
    createReportingAgent,
    reportingAgent,
} from "../reporting_agent/agent.js";
import {
    createStaffCoordinationAgent,
    staffCoordinationAgent,
} from "../staff_coordination_agent/agent.js";
import {
    createTriageAgent,
    triageAgent,
} from "../triage_agent/agent.js";
import {
    rootOrchestratorAgentInputSchema,
    rootOrchestratorAgentOutputSchema,
} from "./contracts.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export function createRootOrchestratorAgent(options: {
    beforeModelCallback?: BeforeModelCallback;
    includeDelegationTools?: boolean;
} = {}) {
    const includeDelegationTools = options.includeDelegationTools ?? true;
    const children = includeDelegationTools
        ? [
              createTriageAgent(),
              createBedManagementAgent(),
              createStaffCoordinationAgent(),
              createReportingAgent(),
          ]
        : [];

    return new LlmAgent({
        name: "er_operations_orchestrator",
        model,
        description:
            "Synthesizes delegated ER workflow outputs into the final operational response.",
        instruction: `You are the Rapid Handoff root orchestrator.

The specialized agents have already completed the workflow reasoning. Your role
is to synthesize their structured outputs into a concise final operational
response for the caller.

Return JSON that matches the schema exactly.
Do not redo the sub-agent reasoning. Summarize the delegated results clearly.`,
        inputSchema: rootOrchestratorAgentInputSchema,
        outputSchema: rootOrchestratorAgentOutputSchema,
        disallowTransferToParent: true,
        disallowTransferToPeers: true,
        subAgents: children,
        tools: children.map((agent) => new AgentTool({ agent })),
        beforeModelCallback: options.beforeModelCallback,
    });
}

export const rootAgent = createRootOrchestratorAgent();
export const rootSynthesisAgent = createRootOrchestratorAgent({
    includeDelegationTools: false,
});

export {
    bedManagementAgent,
    reportingAgent,
    staffCoordinationAgent,
    triageAgent,
    createBedManagementAgent,
    createReportingAgent,
    createStaffCoordinationAgent,
    createTriageAgent,
};
