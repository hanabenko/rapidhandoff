import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { z } from "zod";

import {
    analyzeBedCapacityTool,
    detectBottlenecksTool,
    generateShiftBriefingTool,
    getErCensusSummaryTool,
    recommendStaffingTool,
} from "./agents/orchestrator_agent/tools.js";
import { getOperationsStatus } from "./operations.js";
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

export function getAllowedFrontendOrigins(
    configuredOrigins = process.env.FRONTEND_ORIGIN,
): Set<string> {
    const origins = configuredOrigins
        ?.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

    return new Set(
        origins?.length
            ? origins
            : ["http://localhost:5173", "http://127.0.0.1:5173"],
    );
}

export function createApp() {
    const app = express();
    const allowedFrontendOrigins = getAllowedFrontendOrigins();

    app.disable("x-powered-by");
    app.use((request, response, next) => {
        const requestOrigin = request.header("Origin");
        if (requestOrigin && allowedFrontendOrigins.has(requestOrigin)) {
            response.header("Access-Control-Allow-Origin", requestOrigin);
            response.header("Vary", "Origin");
            response.header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization",
            );
            response.header(
                "Access-Control-Allow-Methods",
                "GET, POST, OPTIONS",
            );
        }

        if (request.method === "OPTIONS") {
            response.sendStatus(204);
            return;
        }

        next();
    });
    app.use(express.json({ limit: "64kb" }));

    app.get("/", (_request, response) => {
        response.json({
            ok: true,
            service: "rapid-handoff-er-orchestrator",
        });
    });

    app.get("/health", (_request, response) => {
        response.json({ ok: true });
    });

    app.get(
        "/operations/status",
        async (_request: Request, response: Response, next: NextFunction) => {
            try {
                response.json(await getOperationsStatus());
            } catch (error) {
                next(error);
            }
        },
    );

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
