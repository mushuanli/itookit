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
    private connected = false;
    private transport: MCPTransport | null = null;

    constructor(private config: MCPServerConfig) {}

    async connect(): Promise<void> {
        switch (this.config.transport) {
            case 'stdio':
                this.transport = new StdioTransport(this.config);
                break;
            case 'sse':
                this.transport = new SSETransport(this.config);
                break;
            case 'websocket':
                this.transport = new WebSocketTransport(this.config);
                break;
            default:
                throw new Error(`Unsupported MCP transport: ${this.config.transport}`);
        }

        await this.transport.connect();
        this.connected = true;
        await this.initialize();
    }

    async disconnect(): Promise<void> {
        if (this.transport) {
            await this.transport.disconnect();
            this.transport = null;
        }
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    async listTools(): Promise<MCPToolInfo[]> {
        const response = await this.sendRequest('tools/list', {});
        return response.tools ?? [];
    }

    async callTool(
        name: string,
        args: Record<string, any>,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<any> {
        const response = await this.sendRequest('tools/call', { name, arguments: args }, options);

        if (response.content && Array.isArray(response.content)) {
            const textParts = response.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text);
            if (textParts.length > 0) return textParts.join('\n');
            return response.content;
        }
        return response;
    }

    private async initialize(): Promise<void> {
        await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'itookit-device-llm', version: '1.0.0' },
        });
        await this.sendNotification('notifications/initialized', {});
    }

    private sendRequest(
        method: string,
        params: any,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<any> {
        if (!this.transport) throw new Error('Not connected');
        return this.transport.request(method, params, options);
    }

    private async sendNotification(method: string, params: any): Promise<void> {
        if (!this.transport) throw new Error('Not connected');
        await this.transport.notify(method, params);
    }
}

// ─── Transport implementations ────────────────────────────────────────────────

interface MCPTransport {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    request(method: string, params: any, options?: { timeout?: number; signal?: AbortSignal }): Promise<any>;
    notify(method: string, params: any): Promise<void>;
}

// ── Stdio ─────────────────────────────────────────────────────────────────────

class StdioTransport implements MCPTransport {
    private process: any = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) {}

    async connect(): Promise<void> {
        if (typeof window !== 'undefined') {
            throw new Error('Stdio transport is not supported in browser environment');
        }

        const { spawn } = await import('child_process');
        this.process = spawn(this.config.command!, this.config.args ?? [], {
            env: { ...process.env, ...this.config.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let buffer = '';
        this.process.stdout.on('data', (data: Buffer) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (line.trim()) {
                    try { this.handleMessage(JSON.parse(line)); } catch { /* ignore non-JSON */ }
                }
            }
        });

        this.process.on('error', (error: Error) => {
            log.error('MCP stdio process error', { error: error.message });
        });
    }

    async disconnect(): Promise<void> {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    async request(
        method: string,
        params: any,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<any> {
        const id = ++this.requestId;
        const message = { jsonrpc: '2.0', id, method, params };

        return new Promise((resolve, reject) => {
            const timeout = options?.timeout ?? 30000;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error('Request timeout'));
            }, timeout);

            options?.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(new DOMException('Aborted', 'AbortError'));
            });

            this.pendingRequests.set(id, {
                resolve: (result: any) => { clearTimeout(timer); resolve(result); },
                reject: (error: any) => { clearTimeout(timer); reject(error); },
            });

            this.process.stdin.write(JSON.stringify(message) + '\n');
        });
    }

    async notify(method: string, params: any): Promise<void> {
        this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    private handleMessage(message: any): void {
        if (message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                if (message.error) {
                    pending.reject(new Error(message.error.message ?? 'Unknown error'));
                } else {
                    pending.resolve(message.result);
                }
            }
        }
    }
}

// ── SSE ───────────────────────────────────────────────────────────────────────

class SSETransport implements MCPTransport {
    private eventSource: EventSource | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) {}

    async connect(): Promise<void> {
        if (!this.config.url) throw new Error('SSE transport requires url');

        this.eventSource = new EventSource(this.config.url);
        this.eventSource.onmessage = (event) => {
            try { this.handleMessage(JSON.parse(event.data)); } catch { /* ignore */ }
        };
        this.eventSource.onerror = () => { log.error('MCP SSE connection error'); };

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
            this.eventSource!.onopen = () => { clearTimeout(timeout); resolve(); };
        });
    }

    async disconnect(): Promise<void> {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    async request(
        method: string,
        params: any,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<any> {
        const message = { jsonrpc: '2.0', id: ++this.requestId, method, params };
        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
            signal: options?.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.error) throw new Error(result.error.message ?? 'Unknown error');
        return result.result;
    }

    async notify(method: string, params: any): Promise<void> {
        await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        });
    }

    private handleMessage(message: any): void {
        if (message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
        }
    }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

class WebSocketTransport implements MCPTransport {
    private ws: WebSocket | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) {}

    async connect(): Promise<void> {
        if (!this.config.url) throw new Error('WebSocket transport requires url');

        this.ws = new WebSocket(this.config.url);
        this.ws.onmessage = (event) => {
            try { this.handleMessage(JSON.parse(event.data)); } catch { /* ignore */ }
        };
        this.ws.onerror = () => { log.error('MCP WebSocket error'); };

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
            this.ws!.onopen = () => { clearTimeout(timeout); resolve(); };
        });
    }

    async disconnect(): Promise<void> {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async request(
        method: string,
        params: any,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<any> {
        const id = ++this.requestId;
        const message = { jsonrpc: '2.0', id, method, params };

        return new Promise((resolve, reject) => {
            const timeout = options?.timeout ?? 30000;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error('Request timeout'));
            }, timeout);

            options?.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(new DOMException('Aborted', 'AbortError'));
            });

            this.pendingRequests.set(id, {
                resolve: (result: any) => { clearTimeout(timer); resolve(result); },
                reject: (error: any) => { clearTimeout(timer); reject(error); },
            });

            this.ws!.send(JSON.stringify(message));
        });
    }

    async notify(method: string, params: any): Promise<void> {
        this.ws!.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }

    private handleMessage(message: any): void {
        if (message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
        }
    }
}
