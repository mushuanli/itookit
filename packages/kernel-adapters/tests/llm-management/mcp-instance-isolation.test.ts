import { afterEach, expect, it, vi } from 'vitest';
import type { Transport } from '@modelcontextprotocol/client';
import { MCP_PROTOCOL_VERSION } from '@itookit/tools/mcp-contracts';
import { MCPClient, MCPServerConnection } from '../../src/llm-management/skills/mcp-client';
import { LLMDeviceDriver } from '../../src/llm-management/core';
import { LLMDeviceDriver as LegacyDriver } from '../../src/llm-management/legacy-device-driver';
import { registerMCPStdioHost } from '../../src/llm-management/mcp-host';
import { MCPManager } from '../../src/llm-management/device/mcp-manager';
import type { MCPConnectionOptions } from '../../src/llm-management/core';

const config = { name: 'shared-name', transport: 'stdio' as const, command: 'unused' };
afterEach(() => vi.unstubAllGlobals());

function hostTransport() {
    const transport: Transport = {
        start: vi.fn(async () => {}), close: vi.fn(async () => { transport.onclose?.(); }),
        send: vi.fn(async message => {
            if (!('id' in message) || !('method' in message)) return;
            transport.onmessage?.({ jsonrpc: '2.0', id: message.id!, result: message.method === 'tools/list' ? { tools: [] } : {
                resultType: 'complete', ttlMs: 0, cacheScope: 'private',
                supportedVersions: [MCP_PROTOCOL_VERSION], capabilities: {},
            } });
        }),
    };
    return transport;
}

it('connects identical configs to independently owned hosts and snapshots caller options', async () => {
    vi.stubGlobal('window', {});
    const first = hostTransport(), second = hostTransport();
    const factoryA = vi.fn(async () => first), factoryB = vi.fn(() => second);
    const options: MCPConnectionOptions = { stdioTransport: factoryA };
    const a = new MCPServerConnection(config, options);
    const b = new MCPServerConnection(config, { stdioTransport: factoryB });
    options.stdioTransport = false;
    try {
        await Promise.all([a.connect(), b.connect()]);
        expect(a.isConnected()).toBe(true); expect(b.isConnected()).toBe(true);
        expect(factoryA).toHaveBeenCalledWith(config); expect(factoryB).toHaveBeenCalledWith(config);
        await a.disconnect(); expect(first.close).toHaveBeenCalledOnce();
        expect(second.close).not.toHaveBeenCalled(); expect(b.isConnected()).toBe(true);
    } finally { await Promise.all([a.disconnect(), b.disconnect()]); }
    expect(second.close).toHaveBeenCalledOnce();
});

it('propagates asynchronous factory failures and honors explicit stdio disabling', async () => {
    const failure = new Error('host unavailable');
    const factory = vi.fn(async () => { throw failure; });
    const failed = new MCPServerConnection(config, { stdioTransport: factory });
    await expect(failed.connect()).rejects.toBe(failure);
    expect(failed.isConnected()).toBe(false); expect(factory).toHaveBeenCalledOnce();
    const disabled = new MCPServerConnection(config, { stdioTransport: false });
    await expect(disabled.connect()).rejects.toThrow('disabled by the host');
});

it('confines legacy registration to compatibility drivers and snapshots it at construction', async () => {
    vi.stubGlobal('window', {});
    const restore = registerMCPStdioHost({ start: vi.fn(), send: vi.fn(), poll: vi.fn(), stop: vi.fn() });
    let legacy!: LegacyDriver;
    try {
        legacy = new LegacyDriver({} as never);
        expect(legacy.supportsMCPStdio()).toBe(true);
        expect(new LLMDeviceDriver({} as never).supportsMCPStdio()).toBe(false);
        expect(new LegacyDriver({} as never, { mcp: {} }).supportsMCPStdio()).toBe(false);
        await expect(new MCPServerConnection(config).connect()).rejects.toThrow('requires a desktop or Node host');
    } finally { restore(); }
    expect(legacy.supportsMCPStdio()).toBe(true);
    expect(new LegacyDriver({} as never).supportsMCPStdio()).toBe(false);
});

it('snapshots driver capability options, including explicit disabling in Node', () => {
    const options: MCPConnectionOptions = { stdioTransport: false };
    const disabled = new LLMDeviceDriver({} as never, { mcp: options });
    options.stdioTransport = vi.fn();
    expect(disabled.supportsMCPStdio()).toBe(false);
    expect(new LLMDeviceDriver({} as never).supportsMCPStdio()).toBe(true);
});

it('forwards instance transports through the client and managed discovery lifecycle', async () => {
    vi.stubGlobal('window', {});
    const transportA = hostTransport(), transportB = hostTransport();
    const factoryA = vi.fn(() => transportA), factoryB = vi.fn(() => transportB);
    const clientOptions: MCPConnectionOptions = { stdioTransport: factoryA };
    const managerOptions: MCPConnectionOptions = { stdioTransport: factoryB };
    const client = new MCPClient({ servers: [config] }, clientOptions);
    const manager = new MCPManager({} as never, {} as never, () => {}, managerOptions);
    clientOptions.stdioTransport = false; managerOptions.stdioTransport = false;
    try {
        await client.initialize();
        const discovery = await manager.testMCPServer({ id: 'one', ...config });
        expect(discovery.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
        expect(factoryA).toHaveBeenCalledOnce(); expect(factoryB).toHaveBeenCalledOnce();
        expect(transportA.start).toHaveBeenCalledOnce(); expect(transportB.start).toHaveBeenCalledOnce();
        await client.disconnectAll(); expect(transportA.close).toHaveBeenCalledOnce();
        expect(transportB.close).not.toHaveBeenCalled();
    } finally { await client.disconnectAll(); await manager.disconnectAll(); }
    expect(transportB.close).toHaveBeenCalledOnce();
});
