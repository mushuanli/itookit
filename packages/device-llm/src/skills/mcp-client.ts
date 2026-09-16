// @file: device-llm/skills/mcp-client.ts
//
// MCPClient — MCP (Model Context Protocol) client.
// Manages connections to multiple MCP servers via stdio / SSE / WebSocket transports.

import { createModuleLogger } from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import type { MCPConfig, MCPServerConfig } from '../types/provider';

const log = createModuleLogger('device-llm:mcp');

// ─── Internal types ───────────────────────────────────────────────────────────

export interface MCPToolInfo {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

// ─── Skill-compatible interfaces ──────────────────────────────────────────────

export interface MCPSkillResult {
    success: boolean;
    data?: any;
    error?: string;
    duration?: number;
    metadata?: Record<string, any>;
}

export interface MCPSkillContext {
    sessionId?: string;
    userId?: string;
    timeout?: number;
    signal?: AbortSignal;
    extra?: Record<string, any>;
}

export interface MCPSkill {
    definition: {
        id: string;
        name: string;
        description: string;
        type: 'mcp';
        tool: ToolDefinition;
        enabled?: boolean;
        metadata?: Record<string, any>;
    };
    execute(args: Record<string, any>, context?: MCPSkillContext): Promise<MCPSkillResult>;
}

// ─── MCPClient ────────────────────────────────────────────────────────────────

/**
 * MCP 客户端
 *
 * 管理多个 MCP 服务器连接。
 * 工具命名规范：`serverName/toolName` → 函数名 `serverName_toolName`
 */
export class MCPClient {
    private servers = new Map<string, MCPServerConnection>();
    private tools = new Map<string, { server: string; tool: MCPToolInfo }>();

    constructor(private config?: MCPConfig) {}

    async initialize(): Promise<void> {
        if (!this.config?.servers) return;
        for (const serverConfig of this.config.servers) {
            try {
                await this.connectServer(serverConfig);
            } catch (error: any) {
                log.error('Failed to connect MCP server', { server: serverConfig.name, error: error.message });
            }
        }
    }

    async connectServer(config: MCPServerConfig): Promise<void> {
        log.debug('Connecting MCP server', { name: config.name, transport: config.transport });

        const connection = new MCPServerConnection(config);
        await connection.connect();
        this.servers.set(config.name, connection);

        const tools = await connection.listTools();
        for (const tool of tools) {
            this.tools.set(`${config.name}/${tool.name}`, { server: config.name, tool });
        }

        log.info('MCP server connected', { name: config.name, toolCount: tools.length });
    }

    async disconnectServer(name: string): Promise<void> {
        const connection = this.servers.get(name);
        if (!connection) return;

        await connection.disconnect();
        this.servers.delete(name);

        for (const [key, value] of this.tools) {
            if (value.server === name) this.tools.delete(key);
        }
    }

    async disconnectAll(): Promise<void> {
        for (const name of this.servers.keys()) {
            await this.disconnectServer(name);
        }
    }

    getToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.entries()).map(([key, { tool }]) => ({
            type: 'function',
            function: {
                name: key.replace('/', '_'),
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    getSkills(): MCPSkill[] {
        return Array.from(this.tools.entries()).map(([key, { server, tool }]) => {
            const skillId = key.replace('/', '_');
            const self = this;
            return {
                definition: {
                    id: skillId,
                    name: tool.name,
                    description: tool.description,
                    type: 'mcp' as const,
                    tool: {
                        type: 'function',
                        function: {
                            name: skillId,
                            description: tool.description,
                            parameters: tool.inputSchema,
                        },
                    },
                    metadata: { server, originalName: tool.name },
                },
                execute(args: Record<string, any>, context?: MCPSkillContext): Promise<MCPSkillResult> {
                    return self.callTool(server, tool.name, args, context);
                },
            };
        });
    }

    async callTool(
        serverName: string,
        toolName: string,
        args: Record<string, any>,
        context?: MCPSkillContext,
    ): Promise<MCPSkillResult> {
        const connection = this.servers.get(serverName);
        if (!connection) {
            return { success: false, error: `MCP server not connected: ${serverName}` };
        }

        try {
            const data = await connection.callTool(toolName, args, {
                timeout: context?.timeout ?? this.config?.timeout ?? 30000,
                signal: context?.signal,
            });
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message ?? 'MCP tool call failed' };
        }
    }

    getServerStatus(): Record<string, { connected: boolean; toolCount: number }> {
        const result: Record<string, { connected: boolean; toolCount: number }> = {};
        for (const [name, connection] of this.servers) {
            const toolCount = Array.from(this.tools.values()).filter(t => t.server === name).length;
            result[name] = { connected: connection.isConnected(), toolCount };
        }
        return result;
    }
}

// ─── MCPServerConnection ──────────────────────────────────────────────────────

export class MCPServerConnection {
    private client: import('@modelcontextprotocol/sdk/client/index.js').Client | undefined;
    private connecting: Promise<void> | undefined;
    constructor(private readonly config: MCPServerConfig) {}

    connect(): Promise<void> {
        if (this.client) return Promise.resolve();
        return this.connecting ??= this.open().finally(() => { this.connecting = undefined; });
    }

    private async open(): Promise<void> {
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const client = new Client({ name: 'mindos', version: '1.0.0' });
        const transport = await this.createTransport();
        try { await client.connect(transport, { timeout: this.config.timeout ?? 30000 }); }
        catch (error) { await client.close(); throw error; }
        this.client = client;
    }

    private async createTransport() {
        const config = this.config;
        if (config.transport === 'stdio') {
            if (typeof window !== 'undefined') throw new Error('MCP stdio requires a Node host');
            if (!config.command) throw new Error('MCP stdio requires command');
            const { createStdioTransport } = await import('#mcp-stdio');
            return createStdioTransport(config);
        }
        if (!config.url) throw new Error('MCP remote transport requires url');
        const url = new URL(config.url);
        if (config.transport === 'websocket') {
            const { WebSocketClientTransport } = await import('@modelcontextprotocol/sdk/client/websocket.js');
            return new WebSocketClientTransport(url);
        }
        if (config.transport === 'sse') {
            const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
            return new SSEClientTransport(url, { requestInit: { headers: config.headers } });
        }
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        return new StreamableHTTPClientTransport(url, { requestInit: { headers: config.headers } });
    }

    async disconnect(): Promise<void> {
        await this.connecting;
        const client = this.client;
        this.client = undefined;
        await client?.close();
    }
    isConnected(): boolean { return Boolean(this.client); }
    async listTools(): Promise<MCPToolInfo[]> {
        if (!this.client) throw new Error('MCP not connected');
        const tools: MCPToolInfo[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
            const page = await this.client.listTools({ cursor });
            tools.push(...page.tools.map(tool => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })));
            cursor = page.nextCursor;
            if (cursor && seen.has(cursor)) throw new Error('MCP tools/list returned a repeated cursor');
            if (cursor) seen.add(cursor);
        } while (cursor);
        return tools;
    }
    async callTool(name: string, args: Record<string, unknown>, options?: { timeout?: number; signal?: AbortSignal }): Promise<unknown> {
        if (!this.client) throw new Error('MCP not connected');
        return this.client.callTool({ name, arguments: args }, undefined, { timeout: options?.timeout ?? this.config.timeout ?? 30000, signal: options?.signal });
    }
}
