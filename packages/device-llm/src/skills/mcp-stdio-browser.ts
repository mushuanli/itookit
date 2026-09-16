import type { MCPServerConfig } from '../types/provider';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export function createStdioTransport(_config: MCPServerConfig): Transport {
    throw new Error('MCP stdio requires a Node host');
}
