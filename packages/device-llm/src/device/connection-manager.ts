// @file: device-llm/device/connection-manager.ts
//
// ConnectionManager — CRUD for LLMConnection with VFS persistence.

import type { LLMConnection, ConnectionMeta } from '@itookit/common';
import type { IVFSManager, IModuleFS } from '@itookit/vfs-core';
import { toConnectionMeta, aggregateProviderCosts } from '@itookit/common';
import { DEFAULT_CONNECTIONS, CONST_CONFIG_VERSION } from '../constants';
import { VFSHelpers } from './vfs-helpers';
import type { ProviderManager } from './provider-manager';

const CONNECTIONS_DIR  = '/llm/.connections';
const DEFAULTS_VERSION = '/llm/.connections_version.json';

export class ConnectionManager {
    private _connections: LLMConnection[] = [];

    constructor(
        private readonly helpers: VFSHelpers,
        private readonly vfs: IVFSManager,
        private readonly providerManager: ProviderManager,
        private readonly onChanged: () => void,
    ) {}

    // ─── Public read accessors ─────────────────────────────────────────────

    getConnections(): ConnectionMeta[] {
        return this._connections.map(c => this.connToMeta(c));
    }

    getConnection(id: string): ConnectionMeta | undefined {
        const c = this.findConn(id);
        return c ? this.connToMeta(c) : undefined;
    }

    getDefaultConnection(): ConnectionMeta | null {
        const c = this.defaultConnection;
        return c ? toConnectionMeta(c) : null;
    }

    getFullConnection(id: string): LLMConnection | null {
        return this.findConn(id) ?? null;
    }

    listConnections(): ConnectionMeta[] {
        return this._connections.map(c => this.connToMeta(c));
    }

    findConnection(id: string): ConnectionMeta | undefined {
        const c = this.findConn(id);
        return c ? this.connToMeta(c) : undefined;
    }

    /** Internal: find raw connection by id (used by openConnectionSession) */
    findRawConnection(id: string): LLMConnection | undefined {
        return this.findConn(id);
    }

    /** All raw connections (used for device node creation) */
    getRawConnections(): LLMConnection[] {
        return this._connections;
    }

    // ─── Mutations ─────────────────────────────────────────────────────────

    async saveConnection(conn: LLMConnection, systemFS?: IModuleFS): Promise<void> {
        await this.writeToDisk(conn, systemFS);
        const idx = this._connections.findIndex(c => c.id === conn.id);
        if (idx >= 0) { this._connections[idx] = conn; } else { this._connections.push(conn); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/connection/${conn.id}`, {
            resourceType: 'connection',
            resourceId: conn.id,
        });
        this.onChanged();

        // Aggregate connection costs into provider dailyCosts
        if (conn.dailyCosts && conn.providerId) {
            this.aggregateAndSaveProviderCosts(conn.providerId, systemFS).catch(() => {});
        }
    }

    async deleteConnection(id: string, systemFS?: IModuleFS): Promise<void> {
        if (id === 'default') throw new Error('Cannot delete the default connection');
        await this.deleteFromDisk(id, systemFS);
        this._connections = this._connections.filter(c => c.id !== id);
        await this.vfs.removeDeviceNode(`/dev/llm/connection/${id}`);
        this.onChanged();
    }

    // ─── Init helpers ──────────────────────────────────────────────────────

    async ensureDefaultsWith(preLoaded: LLMConnection[]): Promise<LLMConnection[]> {
        try {
            const ver = await this.helpers.readJson<{ version: number }>(DEFAULTS_VERSION);
            if (ver && ver.version >= CONST_CONFIG_VERSION) return preLoaded;
            const updated = await this.syncDefaultConnectionsFrom(preLoaded);
            await this.helpers.writeJson(DEFAULTS_VERSION, { version: CONST_CONFIG_VERSION, updatedAt: Date.now() });
            return updated;
        } catch (e) {
            console.error('[ConnectionManager] ensureDefaults failed', e);
            return preLoaded;
        }
    }

    setConnections(connections: LLMConnection[]): void {
        this._connections = connections.map(c => this.normalizeConn(c));
    }

    // ─── VFS reload (called from bindVFSEvents debounce) ──────────────────

    async reload(): Promise<void> {
        this._connections = await this.loadAll();
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private async syncDefaultConnectionsFrom(current: LLMConnection[]): Promise<LLMConnection[]> {
        const byId = new Map(current.map(c => [c.id, c]));
        const result = [...current];

        for (const def of DEFAULT_CONNECTIONS) {
            const existing = byId.get(def.id);
            if (!existing) {
                const newConn: LLMConnection = {
                    id: def.id,
                    name: def.name,
                    providerId: def.providerId,
                    tiers: def.tiers,
                    metadata: { isSystemDefault: true },
                };
                await this.writeToDisk(newConn);
                result.push(newConn);
            } else {
                const updated: LLMConnection = JSON.parse(JSON.stringify(existing));
                let dirty = false;
                if (!updated.tiers && def.tiers) {
                    updated.tiers = def.tiers;
                    dirty = true;
                }
                if (dirty) {
                    await this.writeToDisk(updated);
                    const idx = result.findIndex(c => c.id === def.id);
                    if (idx >= 0) result[idx] = updated;
                }
            }
        }
        return result;
    }

    private async loadAll(systemFS?: IModuleFS): Promise<LLMConnection[]> {
        const raw = await this.helpers.loadJsonFilesFromDir<LLMConnection>(CONNECTIONS_DIR, systemFS);
        return raw.map(c => this.normalizeConn(c));
    }

    private async writeToDisk(conn: LLMConnection, systemFS?: IModuleFS): Promise<void> {
        await this.helpers.engineUpsert(
            `${CONNECTIONS_DIR}/${conn.id}.json`,
            JSON.stringify(conn, null, 2),
            systemFS,
        );
    }

    private async deleteFromDisk(id: string, systemFS?: IModuleFS): Promise<void> {
        const fs = systemFS ?? this.helpers.getEngine();
        const nodeId = await fs.driver.resolvePath(`${CONNECTIONS_DIR}/${id}.json`);
        if (nodeId) await fs.driver.delete([nodeId]);
    }

    private findConn(id: string): LLMConnection | undefined {
        return this._connections.find(c => c.id === id);
    }

    private get defaultConnection(): LLMConnection | undefined {
        return this.findConn('default') ?? this._connections[0];
    }

    private connToMeta(conn: LLMConnection): ConnectionMeta {
        const provider = this.getProviderForConn(conn);
        return toConnectionMeta(conn, provider, this.providerManager.getFullProviderMap().values());
    }

    private getProviderForConn(conn: LLMConnection) {
        const pid = conn.providerId;
        return this.providerManager.getFullProviderMap().get(pid);
    }

    private normalizeConn(raw: LLMConnection): LLMConnection {
        return raw;
    }

    /** Aggregate all connection dailyCosts for a provider and persist */
    private async aggregateAndSaveProviderCosts(providerId: string, systemFS?: IModuleFS): Promise<void> {
        const provider = this.providerManager.getFullProviderMap().get(providerId);
        if (!provider) return;
        const pid = providerId;
        const sameProviderConns = this._connections.filter(
            c => c.providerId === pid
        );
        provider.dailyCosts = aggregateProviderCosts(sameProviderConns);
        await this.providerManager.saveProvider(provider, systemFS);
    }
}
