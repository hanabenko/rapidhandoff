import "dotenv/config";

import { createApp } from "./app.js";
import { ensureTracingInitialized } from "./observability/tracing.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = "0.0.0.0";

ensureTracingInitialized();

createApp().listen(port, host, () => {
    console.log(`Rapid Handoff ER backend listening on ${host}:${port}`);
});
