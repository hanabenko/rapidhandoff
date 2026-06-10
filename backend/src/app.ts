import path from "path";
import { fileURLToPath } from "url";
import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { z } from "zod";

import {
    analyzeBedCapacityTool,
    detectBottlenecksTool,
    generateShiftBriefingTool,
    getErCensusSummaryTool,
    recommendStaffingTool,
} from "./agents/orchestrator_agent/tools.js";
import { orchestrateErOperations } from "./orchestrator.js";

const orchestrateRequestSchema = z.object({
    query: z.string().trim().min(1).max(10_000),
    context: z
        .union([z.string().max(20_000), z.record(z.string(), z.unknown())])
        .optional(),
    userId: z.string().trim().min(1).max(200).optional(),
});

const directTools = {
    census: getErCensusSummaryTool,
    bottlenecks: detectBottlenecksTool,
    staffing: recommendStaffingTool,
    beds: analyzeBedCapacityTool,
    briefing: generateShiftBriefingTool,
} as const;

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "64kb" }));
    app.use(express.static(path.join(__dirname, "../../frontend")));

    app.get("/", (_request, response) => {
        response.json({
            ok: true,
            service: "rapid-handoff-er-orchestrator",
        });
    });

    app.get("/health", (_request, response) => {
        response.json({ ok: true });
    });

    app.post(
        "/agent/orchestrate",
        async (request: Request, response: Response, next: NextFunction) => {
            try {
                const input = orchestrateRequestSchema.parse(request.body);
                response.json(await orchestrateErOperations(input));
            } catch (error) {
                next(error);
            }
        },
    );

    for (const [route, tool] of Object.entries(directTools)) {
        app.post(
            `/tools/${route}`,
            async (request: Request, response: Response, next: NextFunction) => {
                try {
                    const result = await tool.runAsync({
                        args: request.body ?? {},
                        // These tools do not read ADK context when called directly.
                        toolContext: undefined as never,
                    });
                    response.json(result);
                } catch (error) {
                    next(error);
                }
            },
        );
    }

    app.use(
        (
            error: unknown,
            _request: Request,
            response: Response,
            _next: NextFunction,
        ) => {
            if (error instanceof z.ZodError) {
                response.status(400).json({
                    error: "invalid_request",
                    details: error.issues,
                });
                return;
            }

            console.error(error);
            response.status(500).json({
                error: "internal_error",
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
            });
        },
    );

    return app;
}
