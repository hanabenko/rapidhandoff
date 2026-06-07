import "dotenv/config";

import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = "0.0.0.0";

createApp().listen(port, host, () => {
    console.log(`Rapid Handoff ER backend listening on ${host}:${port}`);
});
