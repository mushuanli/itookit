export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;

export interface MCPServer {
    id: string;
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    endpoint?: string;
    status?: 'idle' | 'connected' | 'error';
    args?: string;
    cwd?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    autoConnect?: boolean;
    /** Milliseconds; timeoutUnit marks new writes, legacy UI values <= 300 were seconds. */
    timeout?: number;
    timeoutUnit?: 'ms';
    tools?: unknown[];
    resources?: unknown[];
    prompts?: unknown[];
    icon?: string;
    description?: string;
}

export interface MCPDiscovery {
    protocolVersion?: typeof MCP_PROTOCOL_VERSION;
    capabilities?: { tools: boolean; resources: boolean; prompts: boolean };
    tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
    prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
}

/** Normalize old UI seconds and existing millisecond configurations. */
export function mcpTimeoutMs(server: Pick<MCPServer, 'timeout' | 'timeoutUnit'>): number {
    const timeout = server.timeout ?? 30000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('MCP timeout must be positive');
    return server.timeoutUnit === 'ms' || timeout > 300 ? timeout : timeout * 1000;
}

