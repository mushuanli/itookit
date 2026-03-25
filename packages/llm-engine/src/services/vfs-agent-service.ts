// @file: llm-engine/src/services/vfs-agent-service.ts
//
// Agent 和 MCP Server 的 VFS 持久化服务。
// 连接管理委托给注入的 IConnectionService（由 LLMDeviceDriver 实现），
// 本服务不直接依赖 device-llm 的 ioctl 细节。

import { BaseModuleService } from '@itookit/vfslib';
import type { IVFSManager, VFSManagerEvent } from '@itookit/common';
import type { EngineNode, EngineSearchQuery, RestorableItem } from '@itookit/common';
import { FS_MODULE_AGENTS } from '@itookit/common';
import type { IConnectionService, ConnectionMeta, LLMConnection, AgentDefinition } from '@itookit/common';

import {
    CONST_CONFIG_VERSION,
    LLM_PROVIDER_DEFAULTS,
    DEFAULT_AGENTS,
    AGENT_DEFAULT_DIR,
} from '@itookit/device-llm';
import { IAgentManagementService, MCPServer } from './agent-service';
import { VFSEntityStore, EntityStoreConfig } from '../utils/vfs-entity-store';
import { log } from '../utils/logger';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const VERSION_FILE = '/.defaults_version.json';
const MCP_DIR = '/.mcp';

const MCP_STORE_CONFIG: EntityStoreConfig = {
    dir: MCP_DIR,
    icon: '🔌',
    typeName: 'mcp',
};

// ─── VFSAgentService ──────────────────────────────────────────────────────────

export class VFSAgentService extends BaseModuleService implements IAgentManagementService {
    private _agents: AgentDefinition[] = [];
    private _mcpServers: MCPServer[] = [];
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubscribers: Array<() => void> = [];

    private mcpStore!: VFSEntityStore<MCPServer>;

    constructor(
        vfs: IVFSManager,
        private readonly connectionService: IConnectionService,
    ) {
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration', isSystem: true }, vfs);
    }

    // ─── BaseModuleService lifecycle ─────────────────────────────────────────

    protected async onLoad(): Promise<void> {
        this.mcpStore = new VFSEntityStore(this, this.engine, MCP_STORE_CONFIG);
        await this.ensureDefaults();
        await this.refreshData();
        this.bindVFSEvents();
        // 连接变更时同步通知，保持 IAgentService.onChange 语义不变
        this._eventUnsubscribers.push(
            this.connectionService.onChange(() => this.notify()),
        );
    }

    private bindVFSEvents(): void {
        const debounce = () => {
            if (this._syncTimer) clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(() => this.refreshData(), 300);
        };

        const relevant = (path: string, moduleId: string): boolean => {
            if (moduleId !== this.moduleName) return false;
            const p = path.replace(/\/+/g, '/');
            return p.startsWith(MCP_DIR) || p.endsWith('.agent');
        };

        this._eventUnsubscribers.push(
            this.vfs.on('node:created', (e: VFSManagerEvent<'node:created'>) => {
                if (relevant(e.payload.path, e.payload.moduleId)) debounce();
            }),
            this.vfs.on('node:updated', (e: VFSManagerEvent<'node:updated'>) => {
                if (relevant(e.payload.path, e.payload.moduleId)) debounce();
            }),
            this.vfs.on('node:deleted', (e: VFSManagerEvent<'node:deleted'>) => {
                if (e.payload.moduleId === this.moduleName) debounce();
            }),
        );
    }

    // ─── Data refresh ─────────────────────────────────────────────────────────

    private async refreshData(): Promise<void> {
        try {
            const [agents, mcpServers] = await Promise.all([
                this.scanAgentFiles(),
                this.loadJsonFiles<MCPServer>(MCP_DIR),
            ]);
            this._agents = agents;
            this._mcpServers = mcpServers;
            log.info('Agent service data refreshed', { agentCount: this._agents.length });
            this.notify();
        } catch (e) {
            log.error('Failed to refresh agent service data', { error: e });
        }
    }

    // ─── Defaults ─────────────────────────────────────────────────────────────

    private async ensureDefaults(): Promise<void> {
        try {
            const versionData = await this.readJson<{ version: number }>(VERSION_FILE);
            if (versionData && versionData.version >= CONST_CONFIG_VERSION) return;
            log.info('Syncing default agents');
            await this.syncDefaultAgents();
            await this.writeJson(VERSION_FILE, { version: CONST_CONFIG_VERSION, updatedAt: Date.now() });
        } catch (e) {
            log.error('Failed to ensure defaults', { error: e });
        }
    }

    private async syncDefaultAgents(): Promise<void> {
        const defaultConnId = await this.getDefaultConnectionId();
        const currentAgents = await this.scanAgentFiles();
        const currentIds = new Set(currentAgents.map(a => a.id));
        let created = 0;

        for (const def of DEFAULT_AGENTS) {
            if (currentIds.has(def.id)) continue;
            const filename = `${def.id}.agent`;
            const parentDir = def.initPath || AGENT_DEFAULT_DIR;
            const fullPath = `${parentDir}/${filename}`.replace(/\/+/g, '/');
            if (await this.engine.pathExists(fullPath)) continue;

            const { initPath, initialTags, ...content } = def;
            if (!content.config.connectionId) content.config.connectionId = defaultConnId;

            try {
                await this.ensureDirectory(parentDir);
                const node = await this.engine.createFile(
                    filename, parentDir,
                    JSON.stringify(content, null, 2),
                    { icon: def.icon || '🤖', title: def.name, description: def.description },
                );
                if (initialTags?.length && node?.id) await this.engine.setTags(node.id, initialTags);
                created++;
            } catch { /* ignore per-agent errors */ }
        }

        log.info('Default agents synced', { created });
    }

    // ─── IAgentService — reads ────────────────────────────────────────────────

    async getAgents(): Promise<AgentDefinition[]> {
        return [...this._agents];
    }

    async getAgentConfig(agentId: string): Promise<AgentDefinition | null> {
        let found = this._agents.find(a => a.id === agentId);
        if (!found && agentId === 'default') {
            found = {
                id: 'default', name: 'Default Assistant', type: 'agent',
                icon: '🤖', description: 'Built-in default assistant',
                config: { connectionId: 'default', modelName: '' },
            };
        }
        if (!found) return null;

        const result: AgentDefinition = JSON.parse(JSON.stringify(found));
        if (!result.config.connectionId) result.config.connectionId = 'default';

        const connMeta = await this.getConnection(result.config.connectionId);
        result.config.modelName = this.resolveModelName(connMeta, result.config.modelName);
        return result;
    }

    async getConnection(id: string): Promise<ConnectionMeta | undefined> {
        return this.connectionService.getConnection(id);
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        return this.connectionService.getDefaultConnection();
    }

    // ─── IAgentManagementService — Agent CRUD ─────────────────────────────────

    async saveAgent(agent: AgentDefinition): Promise<void> {
        if (!agent.config.connectionId) agent.config.connectionId = 'default';
        const filename = `${agent.id}.agent`;
        const contentStr = JSON.stringify(agent, null, 2);
        const metadata = { icon: agent.icon || '🤖', title: agent.name, description: agent.description };

        const query: EngineSearchQuery = { text: filename, type: 'file' };
        const results = await this.engine.search(query);
        const existing = results.find((n: EngineNode) => n.name === filename);

        if (existing) {
            await this.engine.writeContent(existing.id, contentStr);
            await this.engine.updateMetadata(existing.id, metadata);
        } else {
            await this.engine.createFile(filename, null, contentStr, metadata);
        }

        await this.refreshData();
    }

    async deleteAgent(agentId: string): Promise<void> {
        const filename = `${agentId}.agent`;
        const query: EngineSearchQuery = { text: filename, type: 'file' };
        const results = await this.engine.search(query);
        const node = results.find((n: EngineNode) => n.name === filename);
        if (node) { await this.engine.delete([node.id]); await this.refreshData(); }
    }

    // ─── IAgentManagementService — Connection (delegate to IConnectionService) ─

    async getConnections(): Promise<ConnectionMeta[]> {
        return this.connectionService.getConnections();
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        return this.connectionService.saveConnection(conn);
    }

    async deleteConnection(id: string): Promise<void> {
        return this.connectionService.deleteConnection(id);
    }

    // ─── IAgentManagementService — MCP ────────────────────────────────────────

    async getMCPServers(): Promise<MCPServer[]> { return [...this._mcpServers]; }

    async saveMCPServer(server: MCPServer): Promise<void> {
        this._mcpServers = await this.mcpStore.save(server, this._mcpServers);
        await this.refreshData();
    }

    async deleteMCPServer(id: string): Promise<void> {
        this._mcpServers = await this.mcpStore.delete(id, this._mcpServers);
        await this.refreshData();
    }

    // ─── Restore / Diagnose ───────────────────────────────────────────────────

    async getRestorableItems(): Promise<RestorableItem[]> {
        const connections = await this.getConnections();
        const connMap = new Map(connections.map(c => [c.id, c]));
        const providerKeys = Object.keys(LLM_PROVIDER_DEFAULTS);
        const items: RestorableItem[] = [];

        for (const [key, def] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const targetId = key === providerKeys[0] ? 'default' : `conn-${key}`;
            const existing = connMap.get(targetId);
            const status = !existing ? 'missing' : existing.provider !== key ? 'modified' : 'ok';
            items.push({
                id: targetId, type: 'connection', name: def.name,
                description: `预设的 ${def.name} 连接配置`,
                icon: (def as any).icon || '🔌', status,
            });
        }

        const agentMap = new Map(this._agents.map(a => [a.id, a]));
        for (const def of DEFAULT_AGENTS) {
            const existing = agentMap.get(def.id);
            const status = !existing ? 'missing' : existing.name !== def.name ? 'modified' : 'ok';
            items.push({
                id: def.id, type: 'agent', name: def.name,
                description: def.description, icon: def.icon || '🤖', status,
            });
        }

        return items;
    }

    async restoreItem(type: 'connection' | 'agent', id: string): Promise<void> {
        if (type === 'connection') await this.restoreConnection(id);
        else await this.restoreAgent(id);
    }

    private async restoreConnection(targetId: string): Promise<void> {
        const keys = Object.keys(LLM_PROVIDER_DEFAULTS);
        const providerKey = targetId === 'default'
            ? keys[0]
            : targetId.startsWith('conn-') ? targetId.replace('conn-', '') : '';
        const providerDef = LLM_PROVIDER_DEFAULTS[providerKey];
        if (!providerDef) throw new Error(`No default definition for connection id: ${targetId}`);

        // 保留用户已配置的 apiKey，仅重置其他字段
        const existing = await this.connectionService.getFullConnection(targetId);
        const existingApiKey = existing?.apiKey ?? '';

        await this.saveConnection({
            id: targetId, name: providerDef.name, provider: providerKey,
            apiKey: existingApiKey, baseURL: providerDef.baseURL,
            model: providerDef.models[0]?.id ?? '',
            availableModels: [...providerDef.models],
            metadata: { isSystemDefault: true },
        });
    }

    private async restoreAgent(agentId: string): Promise<void> {
        const def = DEFAULT_AGENTS.find(a => a.id === agentId);
        if (!def) throw new Error(`No default definition for agent id: ${agentId}`);
        const { initPath, initialTags, ...agentData } = def;
        if (!agentData.config.connectionId) agentData.config.connectionId = 'default';
        await this.saveAgent(agentData as AgentDefinition);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private async getDefaultConnectionId(): Promise<string> {
        const meta = await this.getDefaultConnection();
        return meta?.id ?? 'default';
    }

    private resolveModelName(
        connMeta: ConnectionMeta | undefined,
        currentModelName: string | undefined,
    ): string {
        if (!connMeta?.availableModels?.length) return currentModelName ?? '';
        if (!currentModelName) return connMeta.availableModels[0].id;

        const byName = connMeta.availableModels.find(m => m.name === currentModelName);
        if (byName) return byName.id;
        const byId = connMeta.availableModels.find(m => m.id === currentModelName);
        return byId ? byId.id : connMeta.availableModels[0].id;
    }

    private async loadJsonFiles<T>(dirPath: string): Promise<T[]> {
        const items: T[] = [];
        try {
            const dirId = await this.engine.resolvePath(dirPath);
            if (!dirId) return [];
            const children = await this.engine.getChildren(dirId);
            for (const child of children) {
                if (child.type === 'file' && child.name.endsWith('.json')) {
                    try {
                        const content = await this.engine.readContent(child.id);
                        const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
                        items.push(JSON.parse(jsonStr));
                    } catch { /* skip */ }
                }
            }
        } catch { /* directory doesn't exist */ }
        return items;
    }

    private async scanAgentFiles(): Promise<AgentDefinition[]> {
        const agents: AgentDefinition[] = [];
        try {
            const query: EngineSearchQuery = { text: '.agent', type: 'file' };
            const nodes = await this.engine.search(query);

            const results = await Promise.all(nodes.map(async (node: EngineNode) => {
                if (!node.name.endsWith('.agent')) return null;
                try {
                    const content = await this.engine.readContent(node.id);
                    if (!content) return null;
                    const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
                    const data = JSON.parse(jsonStr) as AgentDefinition;
                    // Compat: rename legacy modelId → modelName
                    if ((data.config as any).modelId && !data.config.modelName) {
                        data.config.modelName = (data.config as any).modelId;
                    }
                    return data.id ? { ...data, tags: node.tags } as AgentDefinition : null;
                } catch { return null; }
            }));

            results.forEach(r => r && agents.push(r));
        } catch (e) {
            console.error('[VFSAgentService] Failed to scan agents:', e);
        }
        return agents;
    }

    async dispose(): Promise<void> {
        this._eventUnsubscribers.forEach(fn => fn());
        this._eventUnsubscribers = [];
        if (this._syncTimer) { clearTimeout(this._syncTimer); this._syncTimer = null; }
        await super.dispose();
    }
}
