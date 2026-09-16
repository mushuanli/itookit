// @file: device-llm/device/mcp-manager.ts
//
// MCPManager — MCP server config storage and active connection lifecycle.

import type { MCPServer } from '@itookit/common';
import type { IVFSManager, IFileSystem } from '@itookit/vfs-core';
import { MCPServerConnection } from '../skills/mcp-client';
import type { MCPServerConfig } from '../types/provider';
import { VFSHelpers } from './vfs-helpers';

const MCP_DIR = '/llm/.mcp';

export class MCPManager {
    private _mcpServers: MCPServer[] = [];
    private connecting = new Map<string, Promise<void>>();
    private _activeMCPConns = new Map<string, MCPServerConnection>();

    constructor(
        private readonly helpers: VFSHelpers,
        private readonly vfs: IVFSManager,
        private readonly onChanged: () => void,
    ) {}

    // ─── Read accessors ────────────────────────────────────────────────────

    getMCPServers(): MCPServer[] {
        return [...this._mcpServers];
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

    async saveMCPServer(server: MCPServer, systemFS?: IFileSystem): Promise<void> {
        await this.writeMCPToDisk(server, systemFS);
        const idx = this._mcpServers.findIndex(s => s.id === server.id);
        if (idx >= 0) { this._mcpServers[idx] = server; } else { this._mcpServers.push(server); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
            resourceType: 'mcp',
            resourceId: server.id,
        });
        this.onChanged();
    }

    async deleteMCPServer(id: string, systemFS?: IFileSystem): Promise<void> {
        await this.deleteMCPFromDisk(id, systemFS);
        this._mcpServers = this._mcpServers.filter(s => s.id !== id);
        const conn = this._activeMCPConns.get(id);
        if (conn) {
            try { await conn.disconnect(); } catch { /* ignore */ }
            this._activeMCPConns.delete(id);
        }
        await this.vfs.removeDeviceNode(`/dev/llm/mcp/${id}`);
        this.onChanged();
    }

    // ─── Init helpers ──────────────────────────────────────────────────────

    setServers(servers: MCPServer[]): void {
        this._mcpServers = servers;
    }

    // ─── VFS reload (called from bindVFSEvents debounce) ──────────────────

    async reload(): Promise<void> {
        this._mcpServers = await this.loadAllMCP();
    }

    // ─── Connection lifecycle ──────────────────────────────────────────────

    async connectMCPServer(server: MCPServer): Promise<void> {
        if (this._activeMCPConns.has(server.id)) return;
        if (!this.connecting.has(server.id)) {
            const connection = new MCPServerConnection(this.mcpServerToConfig(server));
            const pending = connection.connect().then(() => { this._activeMCPConns.set(server.id, connection); })
                .finally(() => { this.connecting.delete(server.id); });
            this.connecting.set(server.id, pending);
        }
        await this.connecting.get(server.id);
    }

    async getOrConnectServer(serverId: string, servers: MCPServer[]): Promise<MCPServerConnection> {
        const server = servers.find(item => item.id === serverId);
        if (!server) throw new Error(`MCP server '${serverId}' not configured`);
        await this.connectMCPServer(server);
        return this._activeMCPConns.get(serverId)!;
    }

    async disconnectServer(id: string): Promise<void> {
        await this.connecting.get(id)?.catch(() => {});
        const conn = this._activeMCPConns.get(id);
        if (conn) {
            try { await conn.disconnect(); } catch { /* ignore */ }
            this._activeMCPConns.delete(id);
        }
    }

    async disconnectAll(): Promise<void> {
        await Promise.allSettled(this.connecting.values());
        for (const conn of this._activeMCPConns.values()) {
            try { await conn.disconnect(); } catch {}
        }
        this._activeMCPConns.clear();
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
            cwd: server.cwd, timeout: server.timeout,
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
