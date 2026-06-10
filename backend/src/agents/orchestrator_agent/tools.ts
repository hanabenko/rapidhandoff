import { FunctionTool } from "@google/adk";
import { z } from "zod";

import {
    SHIFT_VALUES,
    buildBedCapacityAnalysis,
    buildBottleneckAnalysis,
    buildCensusSummary,
    buildShiftBriefing,
    buildStaffingRecommendation,
    type ErSnapshot,
} from "./analytics.js";
import { loadErSnapshot } from "./data.js";

async function withSnapshot<T>(
    operation: (snapshot: ErSnapshot) => T,
): Promise<T | { status: "error"; message: string }> {
    try {
        return operation(await loadErSnapshot());
    } catch (error) {
        return {
            status: "error",
            message: error instanceof Error ? error.message : "Unknown data error.",
        };
    }
}

export const getErCensusSummaryTool = new FunctionTool({
    name: "get_er_census_summary",
    description:
        "Summarizes current ER census, patient status, acuity, and waiting times.",
    parameters: z.object({
        longWaitMinutes: z
            .number()
            .int()
            .min(15)
            .max(720)
            .default(120)
            .describe("Minutes after which a waiting patient is considered delayed."),
    }),
    execute: ({ longWaitMinutes }) =>
        withSnapshot((snapshot) =>
            buildCensusSummary(snapshot, longWaitMinutes),
        ),
});

export const detectBottlenecksTool = new FunctionTool({
    name: "detect_er_bottlenecks",
    description:
        "Detects waiting-room, bed, boarding, turnover, and staffing flow bottlenecks.",
    parameters: z.object({
        waitThresholdMinutes: z
            .number()
            .int()
            .min(15)
            .max(720)
            .default(120)
            .describe("Wait time used to flag delayed patients."),
    }),
    execute: ({ waitThresholdMinutes }) =>
        withSnapshot((snapshot) =>
            buildBottleneckAnalysis(snapshot, waitThresholdMinutes),
        ),
});

export const recommendStaffingTool = new FunctionTool({
    name: "recommend_er_staffing",
    description:
        "Compares current ER workload with available staff and suggests operational coverage changes.",
    parameters: z.object({
        shift: z
            .enum(SHIFT_VALUES)
            .optional()
            .describe("Optional shift whose scheduled staff should be evaluated."),
    }),
    execute: ({ shift }) =>
        withSnapshot((snapshot) => buildStaffingRecommendation(snapshot, shift)),
});

export const analyzeBedCapacityTool = new FunctionTool({
    name: "analyze_er_bed_capacity",
    description:
        "Analyzes occupied, ready, and cleaning-blocked ER beds by bed type.",
    parameters: z.object({}),
    execute: () => withSnapshot(buildBedCapacityAnalysis),
});

export const generateShiftBriefingTool = new FunctionTool({
    name: "generate_er_shift_briefing",
    description:
        "Generates a consolidated ER handoff briefing covering census, bottlenecks, beds, staffing, and recent events.",
    parameters: z.object({
        shift: z
            .enum(SHIFT_VALUES)
            .optional()
            .describe("Optional shift receiving the briefing."),
        lookbackMinutes: z
            .number()
            .int()
            .min(30)
            .max(1440)
            .default(240)
            .describe("How far back to summarize ER events."),
    }),
    execute: ({ shift, lookbackMinutes }) =>
        withSnapshot((snapshot) =>
            buildShiftBriefing(snapshot, shift, lookbackMinutes),
        ),
});

export type { ErSnapshot };
