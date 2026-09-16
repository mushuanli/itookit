import type { IToolService, ToolDefinition, ToolExecutionContext } from '@itookit/common';
import type { DeviceContext, IDeviceDriver } from '@itookit/vfs-core';
import { LLM_IOCTL } from '@itookit/device-llm';

const encode = (value: string) => encodeURIComponent(value).replace(/_/g, '%5F').replace(/%/g, '_');
const decode = (value: string) => decodeURIComponent(value.replace(/_([0-9A-F]{2})/g, '%$1'));
export const mcpToolId = (server: string, tool: string) => `mcp__${encode(server)}__${encode(tool)}`;

/** MCP device sessions never escape into Flow definitions or model arguments. */
export class MCPToolAdapter {
    constructor(private readonly driver: IDeviceDriver) {}

    private async session<T>(server: string, use: (context: DeviceContext) => Promise<T>): Promise<T> {
        if (!this.driver.open || !this.driver.ioctl) throw new Error('MCP device is unavailable');
        const base: DeviceContext = { nodeId: 'llm', name: 'llm', metadata: { resourceType: 'mcp', resourceId: server } };
        const sessionId = await this.driver.open(base, { resourceType: 'mcp', resourceId: server });
        const context = { ...base, sessionId };
        try { return await use(context); }
        finally { await this.driver.close?.(context); }
    }

    async call(server: string, tool: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
        context.signal?.throwIfAborted();
        const result = await this.session(server, device => this.driver.ioctl!(device, LLM_IOCTL.MCP_CALL_TOOL,
            { tool, args, timeout: context.timeoutMs, signal: context.signal }));
        if (result && typeof result === 'object' && 'isError' in result && result.isError) {
            throw new Error(`MCP tool failed: ${JSON.stringify(result)}`);
        }
        return typeof result === 'string' ? result : JSON.stringify(result);
    }

    async prepare(service: IToolService, ids: string[]): Promise<void> {
        for (const id of ids) {
            if (!id.startsWith('mcp__') || service.getToolMeta(id)) continue;
            const parts = id.split('__');
            if (parts.length !== 3) throw new Error(`Invalid MCP tool ID: ${id}`);
            const server = decode(parts[1]); const name = decode(parts[2]);
            if (mcpToolId(server, name) !== id) throw new Error(`Noncanonical MCP tool ID: ${id}`);
            const definitions = await this.session(server, device => this.driver.ioctl!(device, LLM_IOCTL.MCP_LIST_TOOLS)) as ToolDefinition[];
            const definition = definitions.find(tool => (tool.function?.name ?? tool.name) === name);
            if (!definition) throw new Error(`MCP tool not found: ${id}`);
            const named = definition.function ? { ...definition, function: { ...definition.function, name: id } } : { ...definition, name: id };
            service.registerTool({ id, name: id, description: String(definition.function?.description ?? definition.description ?? ''),
                type: 'mcp', sideEffect: 'external', timeoutMs: 30000, enabled: true }, named,
            (args, context) => this.call(server, name, args, context));
        }
    }
}
