// @file: device-llm/device/mcp-manager.ts
//
// MCPManager — MCP server config storage and active connection lifecycle.

import { mcpTimeoutMs, type MCPServer, type MCPDiscovery } from '@itookit/llm-common';
import type { IVFSManager, IFileSystem } from '@itookit/vfs-core';
import { MCPServerConnection } from '../skills/mcp-client';
import type { MCPServerConfig } from '../types/provider';
import { VFSHelpers } from './vfs-helpers';

const MCP_DIR = '/llm/.mcp';

export class MCPManager {
    private _mcpServers: MCPServer[] = [];
    private fingerprints = new Map<string, string>();
    private operations = new Map<string, Promise<void>>();
    private closed = false;
    private revisions = new Map<string, number>();
    private _activeMCPConns = new Map<string, MCPServerConnection>();

    constructor(
        private readonly helpers: VFSHelpers,
        private readonly vfs: IVFSManager,
        private readonly onChanged: () => void,
    ) {}

    // ─── Read accessors ────────────────────────────────────────────────────

    getMCPServers(): MCPServer[] {
        return this._mcpServers.map(server => ({ ...server, status: this._activeMCPConns.get(server.id)?.isConnected() ? 'connected' : 'idle' }));
    }

    getServers(): MCPServer[] {
        return this._mcpServers;
    }

    getRawServers(): MCPServer[] {
        return this._mcpServers;
    }

    getActiveConn(serverId: string): MCPServerConnection | undefined {
        return this._activeMCPConns.get(serverId);
    }

    // ─── Mutations ─────────────────────────────────────────────────────────

    saveMCPServer(server: MCPServer, systemFS?: IFileSystem): Promise<void> {
        validateMCPServer(server);
        const snapshot = structuredClone(server);
        return this.serial(snapshot.id, () => this.saveServer(snapshot, systemFS));
    }

    private async saveServer(server: MCPServer, systemFS?: IFileSystem): Promise<void> {
        validateMCPServer(server);
        server = { ...server, timeout: mcpTimeoutMs(server), timeoutUnit: 'ms' };
        const fingerprint = JSON.stringify(this.mcpServerToConfig(server));
        if (this.fingerprints.has(server.id) && this.fingerprints.get(server.id) !== fingerprint) await this.closeServer(server.id);
        await this.writeMCPToDisk(server, systemFS);
        this.revisions.set(server.id, (this.revisions.get(server.id) ?? 0) + 1);
        const idx = this._mcpServers.findIndex(s => s.id === server.id);
        if (idx >= 0) { this._mcpServers[idx] = server; } else { this._mcpServers.push(server); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
            resourceType: 'mcp',
            resourceId: server.id,
        });
        this.onChanged();
    }

    deleteMCPServer(id: string, systemFS?: IFileSystem): Promise<void> {
        validateMCPServerId(id);
        return this.serial(id, () => this.deleteServer(id, systemFS));
    }

    private async deleteServer(id: string, systemFS?: IFileSystem): Promise<void> {
        await this.deleteMCPFromDisk(id, systemFS);
        this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
        this._mcpServers = this._mcpServers.filter(s => s.id !== id);
        await this.closeServer(id);
        await this.vfs.removeDeviceNode(`/dev/llm/mcp/${id}`);
        this.onChanged();
    }

    // ─── Init helpers ──────────────────────────────────────────────────────

    setServers(servers: MCPServer[]): void {
        this._mcpServers = servers;
    }

    // ─── VFS reload (called from bindVFSEvents debounce) ──────────────────

    async reload(): Promise<void> {
        const revisions = new Map(this.revisions);
        const servers = await this.loadAllMCP();
        const ids = new Set([...this._mcpServers.map(server => server.id), ...servers.map(server => server.id)]);
        await Promise.all([...ids].map(id => this.serial(id, async () => {
            if ((revisions.get(id) ?? 0) !== (this.revisions.get(id) ?? 0)) return;
            const server = servers.find(item => item.id === id);
            if (!server || JSON.stringify(this.mcpServerToConfig(server)) !== this.fingerprints.get(id)) await this.closeServer(id);
            this._mcpServers = this._mcpServers.filter(item => item.id !== id);
            if (server) this._mcpServers.push(server);
        })));
    }

    // ─── Connection lifecycle ──────────────────────────────────────────────

    connectMCPServer(server: MCPServer): Promise<void> {
        return this.serial(server.id, () => this.connectServer(server));
    }

    private async connectServer(server: MCPServer): Promise<void> {
        validateMCPServer(server);
        const fingerprint = JSON.stringify(this.mcpServerToConfig(server));
        if (this.fingerprints.get(server.id) !== fingerprint) await this.closeServer(server.id);
        if (this._activeMCPConns.get(server.id)?.isConnected()) return;
        const connection = new MCPServerConnection(this.mcpServerToConfig(server));
        await connection.connect();
        this.fingerprints.set(server.id, fingerprint);
        this._activeMCPConns.set(server.id, connection);
    }

    async readMCPResource(id: string, uri: string): Promise<unknown> {
        return (await this.getOrConnectServer(id, this._mcpServers)).readResource(uri);
    }

    async getMCPPrompt(id: string, name: string, args?: Record<string, string>): Promise<unknown> {
        return (await this.getOrConnectServer(id, this._mcpServers)).getPrompt(name, args);
    }

    testMCPServer(server: MCPServer): Promise<MCPDiscovery> {
        return this.serial(server.id, async () => {
            await this.connectServer(server);
            try { return await this._activeMCPConns.get(server.id)!.discover(); }
            catch (error) { await this.closeServer(server.id); throw error; }
        });
    }

    getOrConnectServer(serverId: string, _servers: MCPServer[]): Promise<MCPServerConnection> {
        return this.serial(serverId, async () => {
            const server = this._mcpServers.find(item => item.id === serverId);
            if (!server) throw new Error(`MCP server '${serverId}' not configured`);
            await this.connectServer(server);
            return this._activeMCPConns.get(serverId)!;
        });
    }

    disconnectServer(id: string): Promise<void> { return this.serial(id, () => this.closeServer(id)); }

    private async closeServer(id: string): Promise<void> {
        const conn = this._activeMCPConns.get(id);
        await conn?.disconnect();
        this.fingerprints.delete(id);
        this._activeMCPConns.delete(id);
    }

    async disconnectAll(): Promise<void> {
        this.closed = true;
        await Promise.allSettled(this.operations.values());
        const results = await Promise.allSettled([...this._activeMCPConns.keys()].map(id => this.closeServer(id)));
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'MCP cleanup failed');
    }

    private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new Error('MCP manager is closed'));
        const result = (this.operations.get(id) ?? Promise.resolve()).then(operation);
        const done = result.then(() => {}, () => {});
        this.operations.set(id, done);
        void done.then(() => { if (this.operations.get(id) === done) this.operations.delete(id); });
        return result;
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private async loadAllMCP(): Promise<MCPServer[]> {
        return this.helpers.loadJsonFilesFromDir<MCPServer>(MCP_DIR);
    }

    private async writeMCPToDisk(server: MCPServer, systemFS?: IFileSystem): Promise<void> {
        await this.helpers.engineUpsert(
            `${MCP_DIR}/${server.id}.json`,
            JSON.stringify(server, null, 2),
            systemFS,
        );
    }

    private async deleteMCPFromDisk(id: string, systemFS?: IFileSystem): Promise<void> {
        const fs = systemFS ?? this.helpers.getFileSystem();
        const nodeId = await fs.driver.resolvePath(`${MCP_DIR}/${id}.json`);
        if (nodeId) await fs.driver.delete([nodeId]);
    }

    /** Convert MCPServer (common) → MCPServerConfig (local transport layer) */
    mcpServerToConfig(server: MCPServer): MCPServerConfig {
        const transport = server.transport;
        return {
            name: server.name,
            transport,
            command: server.command,
            args: parseMcpArgs(server.args),
            url: server.endpoint,
            env: server.env, cwd: server.cwd, timeout: mcpTimeoutMs(server),
            headers: { ...(server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}), ...server.headers },
        };
    }
}

/** JSON arrays preserve spaces and quoting without executing a shell. */
export function parseMcpArgs(value?: string): string[] | undefined {
    if (!value?.trim()) return undefined;
    if (value.trim().startsWith('[')) {
        const args: unknown = JSON.parse(value);
        if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('MCP args must be a JSON string array');
        return args;
    }
    const args = value.match(/(?:[^\s"']+|"[^"\n]*"|'[^'\n]*')+/g) ?? [];
    return args.map(arg => arg.replace(/"([^"\n]*)"|'([^'\n]*)'/g, (_match, double, single) => double ?? single));
}

function validateMCPServerId(id: string): void {
    if (typeof id !== 'string' || !id.trim() || /[/\\\x00-\x1f]/.test(id)) throw new Error('Invalid MCP server ID');
}

function validateMCPServer(server: MCPServer): void {
    validateMCPServerId(server?.id);
    if (typeof server.name !== 'string' || !server.name.trim()) throw new Error('MCP server name is required');
    if (!['stdio', 'http'].includes(server.transport)) throw new Error('MCP 2026-07-28 requires stdio or Streamable HTTP; legacy transports are not supported');
    for (const map of [server.headers, server.env]) {
        if (map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(value => typeof value !== 'string'))) throw new Error('MCP headers and environment must be string maps');
    }
}
