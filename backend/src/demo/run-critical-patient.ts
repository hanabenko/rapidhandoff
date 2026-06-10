import "dotenv/config";

import { runCriticalPatientRuntime } from "./runtime.js";

console.log(JSON.stringify(await runCriticalPatientRuntime(), null, 2));
