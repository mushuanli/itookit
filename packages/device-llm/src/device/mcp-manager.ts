// @file: device-llm/device/mcp-manager.ts
//
// MCPManager — MCP server config storage and active connection lifecycle.

import type { MCPServer } from '@itookit/common';
import type { IVFSManager, IModuleFS } from '@itookit/stdio';
import { MCPServerConnection } from '../skills/mcp-client';
import type { MCPServerConfig } from '../types/provider';
import { VFSHelpers } from './vfs-helpers';

const MCP_DIR = '/llm/.mcp';

export class MCPManager {
    private _mcpServers: MCPServer[] = [];
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

    async saveMCPServer(server: MCPServer, systemFS?: IModuleFS): Promise<void> {
        await this.writeMCPToDisk(server, systemFS);
        const idx = this._mcpServers.findIndex(s => s.id === server.id);
        if (idx >= 0) { this._mcpServers[idx] = server; } else { this._mcpServers.push(server); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
            resourceType: 'mcp',
            resourceId: server.id,
        });
        this.onChanged();
    }

    async deleteMCPServer(id: string, systemFS?: IModuleFS): Promise<void> {
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
        if (this._activeMCPConns.has(server.id)) return; // already connected
        const config = this.mcpServerToConfig(server);
        const conn = new MCPServerConnection(config);
        await conn.connect();
        this._activeMCPConns.set(server.id, conn);
    }

    async getOrConnectServer(serverId: string, servers: MCPServer[]): Promise<MCPServerConnection> {
        let conn = this._activeMCPConns.get(serverId);
        if (!conn) {
            const server = servers.find(s => s.id === serverId);
            if (!server) throw new Error(`MCP server '${serverId}' not configured`);
            const config = this.mcpServerToConfig(server);
            conn = new MCPServerConnection(config);
            await conn.connect();
            this._activeMCPConns.set(serverId, conn);
        }
        return conn;
    }

    async disconnectServer(id: string): Promise<void> {
        const conn = this._activeMCPConns.get(id);
        if (conn) {
            try { await conn.disconnect(); } catch { /* ignore */ }
            this._activeMCPConns.delete(id);
        }
    }

    async disconnectAll(): Promise<void> {
        for (const conn of this._activeMCPConns.values()) {
            try { await conn.disconnect(); } catch {}
        }
        this._activeMCPConns.clear();
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private async loadAllMCP(): Promise<MCPServer[]> {
        return this.helpers.loadJsonFilesFromDir<MCPServer>(MCP_DIR);
    }

    private async writeMCPToDisk(server: MCPServer, systemFS?: IModuleFS): Promise<void> {
        await this.helpers.engineUpsert(
            `${MCP_DIR}/${server.id}.json`,
            JSON.stringify(server, null, 2),
            systemFS,
        );
    }

    private async deleteMCPFromDisk(id: string, systemFS?: IModuleFS): Promise<void> {
        const fs = systemFS ?? this.helpers.getEngine();
        const nodeId = await fs.driver.resolvePath(`${MCP_DIR}/${id}.json`);
        if (nodeId) await fs.driver.delete([nodeId]);
    }

    /** Convert MCPServer (common) → MCPServerConfig (local transport layer) */
    mcpServerToConfig(server: MCPServer): MCPServerConfig {
        const transport = server.transport === 'http' ? 'sse' : server.transport as 'stdio' | 'sse';
        return {
            name: server.name,
            transport,
            command: server.command,
            args: server.args ? server.args.trim().split(/\s+/).filter(Boolean) : undefined,
            url: server.endpoint,
        };
    }
}
