// @file: llm-engine/src/services/vfs-agent-service.ts
//
// Agent VFS 持久化服务。
// 连接 / MCP / Skill 管理全部委托给注入的 ILLMManagementService（由 LLMDeviceDriver 实现）。

import { BaseModuleService } from '@itookit/vfslib';
import type { IVFSManager, VFSManagerEvent } from '@itookit/common';
import type { EngineNode, EngineSearchQuery, RestorableItem } from '@itookit/common';
import { FS_MODULE_AGENTS } from '@itookit/common';
import type {
    ILLMManagementService, ConnectionMeta, LLMConnection,
    AgentDefinition, MCPServer, LLMSkill, LLMProvider,
    InitialAgentDef, ConnectionTestResult,
} from '@itookit/common';

import { IAgentManagementService } from './agent-service';

// Agent 默认存储目录（VFS module-relative path）
const AGENT_DEFAULT_DIR = '/default';
import { log } from '../utils/logger';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const VERSION_FILE = '/.defaults_version.json';

// ─── VFSAgentService ──────────────────────────────────────────────────────────

export class VFSAgentService extends BaseModuleService implements IAgentManagementService {
    private _agents: AgentDefinition[] = [];
    private _agentNodeIds = new Map<string, string>(); // agentId → VFS node ID
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubscribers: Array<() => void> = [];

    constructor(
        vfs: IVFSManager,
        private readonly llmService: ILLMManagementService,
    ) {
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration', isSystem: true }, vfs);
    }

    // ─── BaseModuleService lifecycle ─────────────────────────────────────────

    protected async onLoad(): Promise<void> {
        await this.ensureDefaults();
        await this.refreshData();
        this.bindVFSEvents();
        // 连接变更时同步通知，保持 IAgentConfigService.onChange 语义不变
        this._eventUnsubscribers.push(
            this.llmService.onChange(() => this.notify()),
        );
    }

    private bindVFSEvents(): void {
        const debounce = () => {
            if (this._syncTimer) clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(() => this.refreshData(), 300);
        };

        const relevant = (path: string, moduleId: string): boolean => {
            if (moduleId !== this.moduleName) return false;
            return path.endsWith('.agent');
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
            this._agents = await this.scanAgentFiles();
            log.info('Agent service data refreshed', { agentCount: this._agents.length });
            this.notify();
        } catch (e) {
            log.error('Failed to refresh agent service data', { error: e });
        }
    }

    // ─── Defaults ─────────────────────────────────────────────────────────────

    private async ensureDefaults(): Promise<void> {
        try {
            const configVersion = this.llmService.getConfigVersion();
            const versionData = await this.readJson<{ version: number }>(VERSION_FILE);
            if (versionData && versionData.version >= configVersion) return;
            log.info('Syncing default agents');
            await this.syncDefaultAgents();
            await this.writeJson(VERSION_FILE, { version: configVersion, updatedAt: Date.now() });
        } catch (e) {
            log.error('Failed to ensure defaults', { error: e });
        }
    }

    private async syncDefaultAgents(): Promise<void> {
        const defaultConnId = await this.getDefaultConnectionId();
        let created = 0;

        for (const def of this.llmService.getDefaultAgents()) {
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

    // ─── IAgentConfigService — reads ────────────────────────────────────────────────

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
        return this.llmService.getConnection(id);
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        return this.llmService.getDefaultConnection();
    }

    // ─── IAgentManagementService — Agent CRUD ─────────────────────────────────

    async saveAgent(agent: AgentDefinition): Promise<void> {
        if (!agent.config.connectionId) agent.config.connectionId = 'default';
        const filename = `${agent.id}.agent`;
        const contentStr = JSON.stringify(agent, null, 2);
        const metadata = { icon: agent.icon || '🤖', title: agent.name, description: agent.description };

        const cachedId = this._agentNodeIds.get(agent.id);
        if (cachedId) {
            await this.engine.writeContent(cachedId, contentStr);
            await this.engine.updateMetadata(cachedId, metadata);
        } else {
            // Cache miss: search for existing file (only before first scan completes)
            const query: EngineSearchQuery = { text: filename, type: 'file' };
            const results = await this.engine.search(query);
            const existing = results.find((n: EngineNode) => n.name === filename);
            if (existing) {
                this._agentNodeIds.set(agent.id, existing.id);
                await this.engine.writeContent(existing.id, contentStr);
                await this.engine.updateMetadata(existing.id, metadata);
            } else {
                const node = await this.engine.createFile(filename, null, contentStr, metadata);
                if (node?.id) this._agentNodeIds.set(agent.id, node.id);
            }
        }

        // Update in-memory list directly; VFS event debounce will refresh from disk
        const idx = this._agents.findIndex(a => a.id === agent.id);
        if (idx >= 0) {
            this._agents[idx] = { ...agent, tags: this._agents[idx].tags };
        } else {
            this._agents.push(agent);
        }
        this.notify();
    }

    async deleteAgent(agentId: string): Promise<void> {
        const cachedId = this._agentNodeIds.get(agentId);
        if (cachedId) {
            await this.engine.delete([cachedId]);
            this._agentNodeIds.delete(agentId);
        } else {
            const filename = `${agentId}.agent`;
            const query: EngineSearchQuery = { text: filename, type: 'file' };
            const results = await this.engine.search(query);
            const node = results.find((n: EngineNode) => n.name === filename);
            if (node) await this.engine.delete([node.id]);
        }
        this._agents = this._agents.filter(a => a.id !== agentId);
        this.notify();
    }

    // ─── ILLMManagementService — 全部委托给 llmService（LLMDeviceDriver）─────

    getConfigVersion(): number { return this.llmService.getConfigVersion(); }
    getDefaultAgents(): InitialAgentDef[] { return this.llmService.getDefaultAgents(); }
    getProviderDefaults(): Record<string, LLMProvider> { return this.llmService.getProviderDefaults(); }
    getProvider(providerId: string): LLMProvider | undefined { return this.llmService.getProvider(providerId); }
    getProviders(): LLMProvider[] { return this.llmService.getProviders(); }
    getFullProvider(id: string): LLMProvider | undefined { return this.llmService.getFullProvider(id); }
    async saveProvider(provider: LLMProvider): Promise<void> { return this.llmService.saveProvider(provider); }
    async deleteProvider(id: string): Promise<void> { return this.llmService.deleteProvider(id); }
    async testConnection(params: { provider: string; apiKey: string; baseURL?: string; model?: string }): Promise<ConnectionTestResult> { return this.llmService.testConnection(params); }

    async getConnections(): Promise<ConnectionMeta[]> { return this.llmService.getConnections(); }
    async getFullConnection(id: string): Promise<LLMConnection | null> { return this.llmService.getFullConnection(id); }
    async saveConnection(conn: LLMConnection): Promise<void> { return this.llmService.saveConnection(conn); }
    async deleteConnection(id: string): Promise<void> { return this.llmService.deleteConnection(id); }

    async getMCPServers(): Promise<MCPServer[]> { return this.llmService.getMCPServers(); }
    async saveMCPServer(server: MCPServer): Promise<void> { return this.llmService.saveMCPServer(server); }
    async deleteMCPServer(id: string): Promise<void> { return this.llmService.deleteMCPServer(id); }

    async getSkills(): Promise<LLMSkill[]> { return this.llmService.getSkills(); }
    async saveSkill(skill: LLMSkill): Promise<void> { return this.llmService.saveSkill(skill); }
    async deleteSkill(id: string): Promise<void> { return this.llmService.deleteSkill(id); }

    // ─── Restore / Diagnose ───────────────────────────────────────────────────

    async getRestorableItems(): Promise<RestorableItem[]> {
        const connections = await this.getConnections();
        const connMap = new Map(connections.map(c => [c.id, c]));
        const providerDefaults = this.llmService.getProviderDefaults();
        const providerKeys = Object.keys(providerDefaults);
        const items: RestorableItem[] = [];

        // ── Layer 1: Providers ─────────────────────────────────────────────────
        for (const [key, def] of Object.entries(providerDefaults)) {
            const vfsProvider = this.llmService.getFullProvider(key);
            const status: RestorableItem['status'] = !vfsProvider
                ? 'missing'
                : vfsProvider.baseURL !== def.baseURL || vfsProvider.models.length !== def.models.length
                    ? 'modified'
                    : 'ok';
            items.push({
                id: key, type: 'provider', name: def.name,
                description: `${def.implementation} · ${def.baseURL || '自定义端点'}`,
                icon: (def as any).icon || '🏭', status,
            });
        }

        // ── Layer 2: Connections ───────────────────────────────────────────────
        for (const [key, def] of Object.entries(providerDefaults)) {
            const targetId = key === providerKeys[0] ? 'default' : `conn-${key}`;
            const existing = connMap.get(targetId);
            const status: RestorableItem['status'] = !existing ? 'missing'
                : existing.providerId !== key ? 'modified' : 'ok';
            items.push({
                id: targetId, type: 'connection', name: def.name,
                description: `${def.name} 的默认连接配置`,
                icon: (def as any).icon || '🔗', status,
            });
        }

        // ── Layer 3: Agents ────────────────────────────────────────────────────
        const agentMap = new Map(this._agents.map(a => [a.id, a]));
        for (const def of this.llmService.getDefaultAgents()) {
            const existing = agentMap.get(def.id);
            const status: RestorableItem['status'] = !existing ? 'missing'
                : existing.name !== def.name ? 'modified' : 'ok';
            items.push({
                id: def.id, type: 'agent', name: def.name,
                description: def.description, icon: def.icon || '🤖', status,
            });
        }

        return items;
    }

    async restoreItem(type: 'provider' | 'connection' | 'agent', id: string): Promise<void> {
        if (type === 'provider')    await this.restoreProvider(id);
        else if (type === 'connection') await this.restoreConnection(id);
        else await this.restoreAgent(id);
    }

    async resetAllDefaults(): Promise<void> {
        const providerDefaults = this.llmService.getProviderDefaults();
        const providerKeys = Object.keys(providerDefaults);

        // Reset providers (keep existing apiKey)
        for (const id of Object.keys(providerDefaults)) {
            await this.restoreProvider(id);
        }
        // Reset connections
        for (const key of providerKeys) {
            const targetId = key === providerKeys[0] ? 'default' : `conn-${key}`;
            await this.restoreConnection(targetId);
        }
        // Reset agents
        for (const def of this.llmService.getDefaultAgents()) {
            await this.restoreAgent(def.id);
        }
    }

    private async restoreProvider(providerId: string): Promise<void> {
        const builtinDef = this.llmService.getProviderDefaults()[providerId];
        if (!builtinDef) throw new Error(`No built-in definition for provider: ${providerId}`);
        // Reset to built-in defaults, preserving user's apiKey
        const existing = this.llmService.getFullProvider(providerId);
        await this.saveProvider({
            ...builtinDef,
            id: providerId,
            isBuiltin: true,
            apiKey: existing?.apiKey,  // preserve user's apiKey
        });
    }

    private async restoreConnection(targetId: string): Promise<void> {
        const providerDefaults = this.llmService.getProviderDefaults();
        const keys = Object.keys(providerDefaults);
        const providerKey = targetId === 'default'
            ? keys[0]
            : targetId.startsWith('conn-') ? targetId.replace('conn-', '') : '';
        const providerDef = providerDefaults[providerKey];
        if (!providerDef) throw new Error(`No default definition for connection id: ${targetId}`);

        // apiKey is now on Provider, not Connection — reset to lean connection
        // Restore to lean connection — user re-configures tiers via ConnectionSettingsEditor
        await this.saveConnection({
            id: targetId,
            name: providerDef.name,
            providerId: providerKey,
            metadata: { isSystemDefault: true },
        });
    }

    private async restoreAgent(agentId: string): Promise<void> {
        const def = this.llmService.getDefaultAgents().find(a => a.id === agentId);
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
        // Model names are now resolved via provider catalog, not connection.availableModels.
        // Return the modelTier-resolved model or the current name as-is.
        if (!currentModelName) return connMeta?.model ?? '';
        return currentModelName;
    }

    private async scanAgentFiles(): Promise<AgentDefinition[]> {
        const agents: AgentDefinition[] = [];
        this._agentNodeIds.clear();
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
                    if (data.id) {
                        this._agentNodeIds.set(data.id, node.id);
                        return { ...data, tags: node.tags } as AgentDefinition;
                    }
                    return null;
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
        this._agentNodeIds.clear();
        await super.dispose();
    }
}
