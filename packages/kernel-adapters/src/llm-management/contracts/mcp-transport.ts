import type { Transport } from '@modelcontextprotocol/client';
import type { MCPServerConfig } from '../skills/types';

/** A host supplies one independently owned transport per connection. */
export type MCPStdioTransportFactory = (config: MCPServerConfig) => Transport | Promise<Transport>;
export interface MCPConnectionOptions {
    /** Omitted: use Node stdio when available. False: disable stdio explicitly. */
    stdioTransport?: MCPStdioTransportFactory | false;
}
