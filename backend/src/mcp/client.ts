import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpEndpointConfig } from "./config.js";

export class RemoteMcpClient {
    private client?: Client;
    private transport?: Transport;
    private connecting?: Promise<Client>;

    constructor(
        private readonly name: string,
        private readonly config: McpEndpointConfig,
    ) {}

    async callTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<unknown> {
        const client = await this.connect();
        return client.callTool({
            name: toolName,
            arguments: args,
        });
    }

    async listTools(): Promise<unknown> {
        return (await this.connect()).listTools();
    }

    async close(): Promise<void> {
        await this.transport?.close();
        this.client = undefined;
        this.transport = undefined;
        this.connecting = undefined;
    }

    private async connect(): Promise<Client> {
        if (this.client) {
            return this.client;
        }

        this.connecting ??= this.createConnection();

        try {
            return await this.connecting;
        } catch (error) {
            this.connecting = undefined;
            throw error;
        }
    }

    private async createConnection(): Promise<Client> {
        const transport =
            this.config.transport === "stdio"
                ? new StdioClientTransport({
                      command: this.config.command,
                      args: this.config.args,
                      env: this.config.env,
                  })
                : new StreamableHTTPClientTransport(
                      new URL(this.config.url),
                      {
                          requestInit: {
                              headers: this.config.authorization
                                  ? {
                                        Authorization:
                                            this.config.authorization,
                                    }
                                  : undefined,
                          },
                      },
                  );
        const client = new Client({
            name: `rapid-handoff-${this.name}`,
            version: "1.0.0",
        });

        await client.connect(transport);
        this.transport = transport;
        this.client = client;
        return client;
    }
}
