import assert from "node:assert/strict";
import test from "node:test";

import { getMongoMcpConfig, getPhoenixMcpConfig } from "./config.js";

test("MongoDB MCP defaults to a local npx stdio server", () => {
    const config = getMongoMcpConfig({
        MONGODB_URI: "mongodb://localhost:27017/rapid_handoff",
    });

    assert.deepEqual(config, {
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server"],
        env: {
            MDB_MCP_CONNECTION_STRING:
                "mongodb://localhost:27017/rapid_handoff",
            MDB_MCP_READ_ONLY: "false",
            MDB_MCP_INDEX_CHECK: "true",
            MDB_MCP_LOGGERS: "stderr",
        },
    });
});

test("Phoenix MCP defaults to a local npx stdio server", () => {
    const config = getPhoenixMcpConfig({
        PHOENIX_API_KEY: "phoenix-key",
        PHOENIX_BASE_URL: "https://app.phoenix.arize.com",
    });

    assert.deepEqual(config, {
        transport: "stdio",
        command: "npx",
        args: [
            "-y",
            "@arizeai/phoenix-mcp@latest",
            "--baseUrl",
            "https://app.phoenix.arize.com",
            "--apiKey",
            "phoenix-key",
        ],
    });
});
