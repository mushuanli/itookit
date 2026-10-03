import type { LLMLogSink } from '@itookit/driver-llm/contracts';
import type { Transport } from '@modelcontextprotocol/client';
import type { MCPServerConfig } from '../skills/types';

/** A host supplies one independently owned transport per connection. */
export type MCPStdioTransportFactory = (config: MCPServerConfig) => Transport | Promise<Transport>;
export interface MCPConnectionOptions {
    /** Omitted: use Node stdio when available. False: disable stdio explicitly. */
    stdioTransport?: MCPStdioTransportFactory | false;
    logger?: LLMLogSink;
    clientInfo?: { name: string; version: string };
}

/** Preserve host service identity while detaching caller-owned client metadata. */
export function snapshotMCPConnectionOptions(options: MCPConnectionOptions = {}): MCPConnectionOptions {
    const clientInfo = options.clientInfo;
    if (clientInfo !== undefined && (!clientInfo || typeof clientInfo !== 'object'
        || [clientInfo.name, clientInfo.version].some(value => typeof value !== 'string' || !value.trim()))) {
        throw new Error('MCP client name and version must be non-empty strings');
    }
    return Object.freeze({ ...options, ...(clientInfo ? { clientInfo: Object.freeze({ ...clientInfo }) } : {}) });
}
