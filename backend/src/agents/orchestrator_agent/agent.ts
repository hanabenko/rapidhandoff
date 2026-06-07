import "dotenv/config";

import { LlmAgent } from "@google/adk";

import {
    analyzeBedCapacityTool,
    detectBottlenecksTool,
    generateShiftBriefingTool,
    getErCensusSummaryTool,
    recommendStaffingTool,
} from "./tools.js";

const model = process.env.ER_ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export const rootAgent = new LlmAgent({
    name: "er_operations_orchestrator",
    model,
    description:
        "Routes emergency department operations questions to census, flow, staffing, capacity, and briefing tools.",
    instruction: `You are an emergency department operations orchestrator.

Use the available tools for every question that depends on current ER data.

Routing rules:
- Census, patient counts, acuity, waits, or treatment load: call get_er_census_summary.
- Delays, queues, throughput, crowding, or flow constraints: call detect_er_bottlenecks.
- Coverage, workload, or staffing requests: call recommend_er_staffing.
- Bed occupancy, bed types, cleaning, or capacity questions: call analyze_er_bed_capacity.
- Handoffs, huddles, or shift reports: call generate_er_shift_briefing.
- For broad operational questions, call every relevant tool and synthesize the results.

State the data timestamp and important assumptions. Be concise, prioritize urgent
operational risks, and separate observed facts from recommendations. Do not invent
patient details or make diagnoses, treatment decisions, or replace clinical judgment.
When a tool reports unavailable data, explain the configuration problem clearly.`,
    tools: [
        getErCensusSummaryTool,
        detectBottlenecksTool,
        recommendStaffingTool,
        analyzeBedCapacityTool,
        generateShiftBriefingTool,
    ],
});
