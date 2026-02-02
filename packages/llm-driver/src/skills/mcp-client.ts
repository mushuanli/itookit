// @file: llm-driver/skills/mcp-client.ts

import { Skill, SkillExecutionContext, SkillResult } from './types';
import { MCPServerConfig, MCPConfig } from '../types/provider';
import { ToolDefinition } from '../types/message';
import { log } from '../utils/logger';

/**
 * MCP 工具信息
 */
interface MCPToolInfo {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

/**
 * MCP 客户端
 * 
 * 实现 Model Context Protocol 客户端，用于连接 MCP 服务器
 */
export class MCPClient {
    private servers = new Map<string, MCPServerConnection>();
    private tools = new Map<string, { server: string; tool: MCPToolInfo }>();

    constructor(private config?: MCPConfig) { }

    /**
     * 初始化所有配置的服务器
     */
    async initialize(): Promise<void> {
        if (!this.config?.servers) {
            return;
        }

        for (const serverConfig of this.config.servers) {
            try {
                await this.connectServer(serverConfig);
            } catch (error: any) {
                log.error('Failed to connect MCP server', {
                    server: serverConfig.name,
                    error: error.message
                });
            }
        }
    }

    /**
     * 连接 MCP 服务器
     */
    async connectServer(config: MCPServerConfig): Promise<void> {
        log.debug('Connecting MCP server', { name: config.name, transport: config.transport });

        const connection = new MCPServerConnection(config);
        await connection.connect();

        this.servers.set(config.name, connection);

        // 获取工具列表
        const tools = await connection.listTools();
        for (const tool of tools) {
            this.tools.set(`${config.name}/${tool.name}`, {
                server: config.name,
                tool
            });
        }

        log.info('MCP server connected', {
            name: config.name,
            toolCount: tools.length
        });
    }

    /**
     * 断开服务器连接
     */
    async disconnectServer(name: string): Promise<void> {
        const connection = this.servers.get(name);
        if (connection) {
            await connection.disconnect();
            this.servers.delete(name);

            // 移除该服务器的工具
            for (const [key, value] of this.tools) {
                if (value.server === name) {
                    this.tools.delete(key);
                }
            }
        }
    }

    /**
     * 断开所有连接
     */
    async disconnectAll(): Promise<void> {
        for (const name of this.servers.keys()) {
            await this.disconnectServer(name);
        }
    }

    /**
     * 获取所有工具定义
     */
    getToolDefinitions(): ToolDefinition[] {
        const definitions: ToolDefinition[] = [];

        for (const [key, { tool }] of this.tools) {
            definitions.push({
                type: 'function',
                function: {
                    name: key.replace('/', '_'),  // 转换为合法函数名
                    description: tool.description,
                    parameters: tool.inputSchema
                }
            });
        }

        return definitions;
    }

    /**
     * 获取技能列表
     */
    getSkills(): Skill[] {
        const skills: Skill[] = [];

        for (const [key, { server, tool }] of this.tools) {
            const skillId = key.replace('/', '_');

            skills.push({
                definition: {
                    id: skillId,
                    name: tool.name,
                    description: tool.description,
                    type: 'mcp',
                    tool: {
                        type: 'function',
                        function: {
                            name: skillId,
                            description: tool.description,
                            parameters: tool.inputSchema
                        }
                    },
                    metadata: { server, originalName: tool.name }
                },
                execute: async (args, context) => {
                    return this.callTool(server, tool.name, args, context);
                }
            });
        }

        return skills;
    }

    /**
     * 调用工具
     */
    async callTool(
        serverName: string,
        toolName: string,
        args: Record<string, any>,
        context?: SkillExecutionContext
    ): Promise<SkillResult> {
        const connection = this.servers.get(serverName);
        if (!connection) {
            return {
                success: false,
                error: `MCP server not connected: ${serverName}`
            };
        }

        try {
            const result = await connection.callTool(toolName, args, {
                timeout: context?.timeout || this.config?.timeout || 30000,
                signal: context?.signal
            });

            return {
                success: true,
                data: result
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'MCP tool call failed'
            };
        }
    }

    /**
     * 获取服务器状态
     */
    getServerStatus(): Map<string, { connected: boolean; toolCount: number }> {
        const status = new Map<string, { connected: boolean; toolCount: number }>();

        for (const [name, connection] of this.servers) {
            const toolCount = Array.from(this.tools.values())
                .filter(t => t.server === name).length;

            status.set(name, {
                connected: connection.isConnected(),
                toolCount
            });
        }

        return status;
    }
}

/**
 * MCP 服务器连接
 */
class MCPServerConnection {
    private connected = false;
    private transport: MCPTransport | null = null;

    constructor(private config: MCPServerConfig) { }

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
                throw new Error(`Unsupported transport: ${this.config.transport}`);
        }

        await this.transport.connect();
        this.connected = true;

        // 初始化握手
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

    private async initialize(): Promise<void> {
        // MCP 初始化握手
        await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {}
            },
            clientInfo: {
                name: 'itookit-llm-driver',
                version: '1.0.0'
            }
        });

        // 发送 initialized 通知
        await this.sendNotification('notifications/initialized', {});
    }

    async listTools(): Promise<MCPToolInfo[]> {
        const response = await this.sendRequest('tools/list', {});
        return response.tools || [];
    }

    async callTool(
        name: string,
        args: Record<string, any>,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<any> {
        const response = await this.sendRequest('tools/call', {
            name,
            arguments: args
        }, options);

        // 处理响应内容
        if (response.content && Array.isArray(response.content)) {
            // 合并文本内容
            const textParts = response.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text);

            if (textParts.length > 0) {
                return textParts.join('\n');
            }

            return response.content;
        }

        return response;
    }

    private async sendRequest(
        method: string,
        params: any,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<any> {
        if (!this.transport) {
            throw new Error('Not connected');
        }

        return this.transport.request(method, params, options);
    }

    private async sendNotification(method: string, params: any): Promise<void> {
        if (!this.transport) {
            throw new Error('Not connected');
        }

        await this.transport.notify(method, params);
    }
}

/**
 * MCP 传输层接口
 */
interface MCPTransport {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    request(method: string, params: any, options?: { timeout?: number; signal?: AbortSignal }): Promise<any>;
    notify(method: string, params: any): Promise<void>;
}

/**
 * Stdio 传输 (用于本地进程)
 */
class StdioTransport implements MCPTransport {
    private process: any = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) { }

    async connect(): Promise<void> {
        // 在 Node.js 环境中使用 child_process
        // 在浏览器环境中需要通过后端代理
        if (typeof window !== 'undefined') {
            throw new Error('Stdio transport is not supported in browser environment');
        }

        const { spawn } = await import('child_process');

        this.process = spawn(this.config.command!, this.config.args || [], {
            env: { ...process.env, ...this.config.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // 处理响应
        let buffer = '';
        this.process.stdout.on('data', (data: Buffer) => {
            buffer += data.toString();

            // 按行处理
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const message = JSON.parse(line);
                        this.handleMessage(message);
                    } catch {
                        // 忽略非 JSON 行
                    }
                }
            }
        });

        this.process.on('error', (error: Error) => {
            log.error('MCP process error', { error: error.message });
        });

        this.process.on('exit', (code: number) => {
            log.debug('MCP process exited', { code });
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
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<any> {
        const id = ++this.requestId;

        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            // 设置超时
            const timeout = options?.timeout || 30000;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error('Request timeout'));
            }, timeout);

            // 处理中止
            if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            }

            this.pendingRequests.set(id, {
                resolve: (result: any) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                reject: (error: any) => {
                    clearTimeout(timer);
                    reject(error);
                }
            });

            // 发送请求
            this.process.stdin.write(JSON.stringify(message) + '\n');
        });
    }

    async notify(method: string, params: any): Promise<void> {
        const message = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    private handleMessage(message: any): void {
        if (message.id !== undefined) {
            // 响应
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);

                if (message.error) {
                    pending.reject(new Error(message.error.message || 'Unknown error'));
                } else {
                    pending.resolve(message.result);
                }
            }
        }
        // 通知消息可以在这里处理
    }
}

/**
 * SSE 传输 (用于 HTTP 服务器)
 */
class SSETransport implements MCPTransport {
    private eventSource: EventSource | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) { }

    async connect(): Promise<void> {
        if (!this.config.url) {
            throw new Error('SSE transport requires url');
        }

        this.eventSource = new EventSource(this.config.url);

        this.eventSource.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch {
                // 忽略
            }
        };

        this.eventSource.onerror = () => {
            log.error('SSE connection error');
        };

        // 等待连接建立
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

            this.eventSource!.onopen = () => {
                clearTimeout(timeout);
                resolve();
            };
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
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<any> {
        const id = ++this.requestId;

        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        // 通过 POST 发送请求
        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
            signal: options?.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (result.error) {
            throw new Error(result.error.message || 'Unknown error');
        }

        return result.result;
    }

    async notify(method: string, params: any): Promise<void> {
        const message = {
            jsonrpc: '2.0',
            method,
            params
        };

        await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
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

/**
 * WebSocket 传输
 */
class WebSocketTransport implements MCPTransport {
    private ws: WebSocket | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

    constructor(private config: MCPServerConfig) { }

    async connect(): Promise<void> {
        if (!this.config.url) {
            throw new Error('WebSocket transport requires url');
        }

        this.ws = new WebSocket(this.config.url);

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch {
                // 忽略
            }
        };

        this.ws.onerror = () => {
            log.error('WebSocket error');
        };

        // 等待连接
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

            this.ws!.onopen = () => {
                clearTimeout(timeout);
                resolve();
            };
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
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<any> {
        const id = ++this.requestId;

        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            const timeout = options?.timeout || 30000;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error('Request timeout'));
            }, timeout);

            if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            }

            this.pendingRequests.set(id, {
                resolve: (result: any) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                reject: (error: any) => {
                    clearTimeout(timer);
                    reject(error);
                }
            });

            this.ws!.send(JSON.stringify(message));
        });
    }

    async notify(method: string, params: any): Promise<void> {
        const message = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.ws!.send(JSON.stringify(message));
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
