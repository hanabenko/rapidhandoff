export interface HttpMcpConfig {
    transport: "http";
    url: string;
    authorization?: string;
}

export interface StdioMcpConfig {
    transport: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export type McpEndpointConfig = HttpMcpConfig | StdioMcpConfig;

function optionalBearerToken(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
}

function requireUrl(name: string, value: string | undefined): string {
    if (!value) {
        throw new Error(`${name} is required to connect to the MCP server.`);
    }

    return new URL(value).toString();
}

function requireValue(name: string, value: string | undefined): string {
    if (!value) {
        throw new Error(`${name} is required to launch the local MCP server.`);
    }

    return value;
}

export function getMongoMcpConfig(
    env: NodeJS.ProcessEnv = process.env,
): McpEndpointConfig {
    if (env.MONGODB_MCP_URL) {
        return {
            transport: "http",
            url: requireUrl("MONGODB_MCP_URL", env.MONGODB_MCP_URL),
            authorization: optionalBearerToken(env.MONGODB_MCP_AUTH_TOKEN),
        };
    }

    return {
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server"],
        env: {
            MDB_MCP_CONNECTION_STRING: requireValue(
                "MONGODB_URI",
                env.MONGODB_URI,
            ),
            MDB_MCP_READ_ONLY: env.MDB_MCP_READ_ONLY ?? "false",
            // Dashboard snapshots intentionally perform bounded collection
            // reads, which MongoDB reports as COLLSCAN even with ID indexes.
            MDB_MCP_INDEX_CHECK: env.MDB_MCP_INDEX_CHECK ?? "false",
            MDB_MCP_LOGGERS: env.MDB_MCP_LOGGERS ?? "stderr",
        },
    };
}

export function getPhoenixMcpConfig(
    env: NodeJS.ProcessEnv = process.env,
): McpEndpointConfig {
    if (env.PHOENIX_MCP_URL) {
        return {
            transport: "http",
            url: requireUrl("PHOENIX_MCP_URL", env.PHOENIX_MCP_URL),
            authorization: optionalBearerToken(env.PHOENIX_API_KEY),
        };
    }

    return {
        transport: "stdio",
        command: "npx",
        args: [
            "-y",
            "@arizeai/phoenix-mcp@latest",
            "--baseUrl",
            requireValue("PHOENIX_BASE_URL", env.PHOENIX_BASE_URL),
            "--apiKey",
            requireValue("PHOENIX_API_KEY", env.PHOENIX_API_KEY),
        ],
    };
}
