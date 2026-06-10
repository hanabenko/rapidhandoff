export interface McpEndpointConfig {
    url: string;
    authorization?: string;
}

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

export function getMongoMcpConfig(): McpEndpointConfig {
    return {
        url: requireUrl("MONGODB_MCP_URL", process.env.MONGODB_MCP_URL),
        authorization: optionalBearerToken(process.env.MONGODB_MCP_AUTH_TOKEN),
    };
}

export function getPhoenixMcpConfig(): McpEndpointConfig {
    return {
        url: requireUrl("PHOENIX_MCP_URL", process.env.PHOENIX_MCP_URL),
        authorization: optionalBearerToken(process.env.PHOENIX_MCP_API_KEY),
    };
}
