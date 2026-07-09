// @file: llm-engine/src/services/vfs-agent-service.ts
//
// Agent VFS 持久化服务。
// 连接 / MCP / Skill 管理全部委托给注入的 ILLMManagementService（由 LLMDeviceDriver 实现）。

import { BaseModuleService } from '@itookit/vfslib';
import type { IVFSManager, VFSManagerEvent } from '@itookit/common';
import type { FSNode, FSSearchQuery, RestorableItem } from '@itookit/common';
import { FS_MODULE_AGENTS } from '@itookit/common';
import type {
    ILLMManagementService, ConnectionMeta, LLMConnection,
    AgentDefinition, MCPServer, LLMSkill, LLMProvider,
    InitialAgentDef, DefaultConnectionDef, ConnectionTestResult,
} from '@itookit/common';

import { IAgentManagementService } from './agent-service';
import { log } from '../utils/logger';

// Agent 默认存储目录（VFS module-relative path）
const AGENT_DEFAULT_DIR = '/default';

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
            this._syncTimer = setTimeout(async () => {
                await this.refreshData();
                this.notify();
            }, 300);
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

    /** Cancel any pending VFS-event-driven refresh — used after local writes */
    private cancelPendingSync(): void {
        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
    }

    private async refreshData(): Promise<void> {
        try {
            this._agents = await this.scanAgentFiles();
            log.info('Agent service data refreshed', { agentCount: this._agents.length });
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
            if (await this.engine.driver.exists(fullPath)) continue;

            const { initPath, initialTags, ...content } = def;
            if (!content.config.connectionId) content.config.connectionId = defaultConnId;

            try {
                await this.ensureDirectory(parentDir);
                const node = await this.engine.driver.createFile({
                    name: filename,
                    parentPath: parentDir,
                    content: JSON.stringify(content, null, 2),
                    metadata: { icon: def.icon || '🤖', title: def.name, description: def.description },
                });
                if (initialTags?.length && node?.path) await this.engine.meta.tags?.setTags(node.path, initialTags);
                created++;
            } catch { /* ignore per-agent errors */ }
        }

        log.info('Default agents synced', { created });
    }

    // ─── IAgentConfigService — reads ────────────────────────────────────────────────

    listAgents(): AgentDefinition[] {
        return [...this._agents];
    }

    findAgent(id: string): AgentDefinition | undefined {
        return this._agents.find(a => a.id === id);
    }

    listConnections(): ConnectionMeta[] {
        return this.llmService.listConnections();
    }

    findConnection(id: string): ConnectionMeta | undefined {
        return this.llmService.findConnection(id);
    }

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
            await this.engine.driver.writeContent(cachedId, contentStr);
            await this.engine.driver.updateMetadata(cachedId, metadata);
        } else {
            // Cache miss: search for existing file (only before first scan completes)
            const query: FSSearchQuery = { name: { contains: filename }, type: 'file' };
            const results = await this.engine.driver.search(query);
            const existing = Array.from(results.nodes).find((n: FSNode) => n.name === filename);
            if (existing) {
                this._agentNodeIds.set(agent.id, existing.path);
                await this.engine.driver.writeContent(existing.path, contentStr);
                await this.engine.driver.updateMetadata(existing.path, metadata);
            } else {
                const node = await this.engine.driver.createFile({
                    name: filename,
                    parentPath: null,
                    content: contentStr,
                    metadata,
                });
                if (node?.path) this._agentNodeIds.set(agent.id, node.path);
            }
        }

        // Update in-memory list directly; suppress VFS event round-trip for local writes
        this.cancelPendingSync();
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
            await this.engine.driver.delete([cachedId]);
            this._agentNodeIds.delete(agentId);
        } else {
            const filename = `${agentId}.agent`;
            const query: FSSearchQuery = { name: { contains: filename }, type: 'file' };
            const results = await this.engine.driver.search(query);
            const node = Array.from(results.nodes).find((n: FSNode) => n.name === filename);
            if (node) await this.engine.driver.delete([node.path]);
        }
        this.cancelPendingSync();
        this._agents = this._agents.filter(a => a.id !== agentId);
        this.notify();
    }

    // ─── ILLMManagementService — 全部委托给 llmService（LLMDeviceDriver）─────

    getConfigVersion(): number { return this.llmService.getConfigVersion(); }
    getDefaultAgents(): InitialAgentDef[] { return this.llmService.getDefaultAgents(); }
    getDefaultConnections() { return this.llmService.getDefaultConnections(); }
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

    async recordCost(params: Parameters<ILLMManagementService['recordCost']>[0]): Promise<void> {
        return this.llmService.recordCost(params);
    }

    async writePricing(config: Parameters<ILLMManagementService['writePricing']>[0]): Promise<void> {
        return this.llmService.writePricing(config);
    }

    async queryCosts(filter?: Parameters<ILLMManagementService['queryCosts']>[0]): Promise<import('@itookit/common').CostRecord[]> {
        return this.llmService.queryCosts(filter);
    }

    getPricingConfig(): import('@itookit/common').ModelPricingConfig {
        return this.llmService.getPricingConfig();
    }

    getPricingDefaults(): import('@itookit/common').ModelPricingConfig {
        return this.llmService.getPricingDefaults();
    }

    // ─── Restore / Diagnose ───────────────────────────────────────────────────

    async getRestorableItems(): Promise<RestorableItem[]> {
        const connections = await this.getConnections();
        const connMap = new Map(connections.map(c => [c.id, c]));
        const providerDefaults = this.llmService.getProviderDefaults();
        const items: RestorableItem[] = [];

        // ── Layer 1: Providers ─────────────────────────────────────────────────
        for (const [key, def] of Object.entries(providerDefaults)) {
            const vfsProvider = this.llmService.getFullProvider(key);
            const status: RestorableItem['status'] = !vfsProvider
                ? 'missing'
                : this.isProviderModified(vfsProvider, def)
                    ? 'modified'
                    : 'ok';
            items.push({
                id: key, type: 'provider', name: def.name,
                description: `${def.implementation} · ${def.baseURL || '自定义端点'}`,
                icon: (def as any).icon || '🏭', status,
            });
        }

        // ── Layer 2: Connections ───────────────────────────────────────────────
        for (const connDef of this.llmService.getDefaultConnections()) {
            const existing = connMap.get(connDef.id);
            const status: RestorableItem['status'] = !existing ? 'missing'
                : await this.isConnectionModified(existing, connDef) ? 'modified' : 'ok';
            const provider = providerDefaults[connDef.providerId];
            items.push({
                id: connDef.id, type: 'connection', name: connDef.name,
                description: `${connDef.name}（${provider?.name ?? connDef.providerId}）`,
                icon: (provider as any)?.icon || '🔗', status,
            });
        }

        // ── Layer 3: Agents ────────────────────────────────────────────────────
        const agentMap = new Map(this._agents.map(a => [a.id, a]));
        for (const def of this.llmService.getDefaultAgents()) {
            const existing = agentMap.get(def.id);
            const status: RestorableItem['status'] = !existing ? 'missing'
                : this.isAgentModified(existing, def) ? 'modified' : 'ok';
            items.push({
                id: def.id, type: 'agent', name: def.name,
                description: def.description, icon: def.icon || '🤖', status,
            });
        }

        return items;
    }

    // ── Diff helpers ─────────────────────────────────────────────────────────

    private isProviderModified(current: LLMProvider, def: LLMProvider): boolean {
        if (current.name !== def.name) return true;
        if (current.baseURL !== def.baseURL) return true;
        if (current.defaultPath !== def.defaultPath) return true;
        if (current.anthropicPath !== def.anthropicPath) return true;
        if (current.enabled !== def.enabled) return true;
        // Compare model identity only. Full deep-equal is unreliable because
        // getFullProvider() returns models with pricing fields injected
        // (applyPricingToModel), which are absent from the built-in defaults.
        if (!deepEqual(current.models.map(m => m.id).sort(), def.models.map(m => m.id).sort())) return true;
        return false;
    }

    private async isConnectionModified(current: ConnectionMeta, def: DefaultConnectionDef): Promise<boolean> {
        if (current.name !== def.name) return true;
        if (current.providerId !== def.providerId) return true;
        // ConnectionMeta doesn't expose tiers/protocol,
        // so fetch full connection for deeper comparison
        const full = await this.llmService.getFullConnection(current.id);
        if (full) {
            if (!deepEqual(full.tiers, def.tiers)) return true;
            if (full.protocol !== def.protocol) return true;
        }
        return false;
    }

    private isAgentModified(current: AgentDefinition, def: InitialAgentDef): boolean {
        if (current.name !== def.name) return true;
        // saveAgent() normalizes empty connectionId → 'default'; mirror that here
        // so a restored agent isn't perpetually flagged as modified.
        const defConnId = def.config.connectionId || 'default';
        if ((current.config.connectionId || 'default') !== defConnId) return true;
        if (current.config.modelTier !== def.config.modelTier) return true;
        if (current.config.systemPrompt !== def.config.systemPrompt) return true;
        if (current.config.temperature !== def.config.temperature) return true;
        if (current.config.maxHistoryLength !== def.config.maxHistoryLength) return true;
        if (!deepEqual(current.defaultPrompts, def.defaultPrompts)) return true;
        return false;
    }

    async restoreItem(type: 'provider' | 'connection' | 'agent', id: string): Promise<void> {
        if (type === 'provider')    await this.restoreProvider(id);
        else if (type === 'connection') await this.restoreConnection(id);
        else await this.restoreAgent(id);
    }

    async resetAllDefaults(): Promise<void> {
        const providerDefaults = this.llmService.getProviderDefaults();

        // Reset providers (keep existing apiKey)
        for (const id of Object.keys(providerDefaults)) {
            await this.restoreProvider(id);
        }
        // Reset connections
        for (const connDef of this.llmService.getDefaultConnections()) {
            await this.restoreConnection(connDef.id);
        }
        // Reset agents
        for (const def of this.llmService.getDefaultAgents()) {
            await this.restoreAgent(def.id);
        }
        // Reset pricing to built-in defaults
        await this.llmService.writePricing(this.llmService.getPricingDefaults());
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
        const connDef = this.llmService.getDefaultConnections().find(c => c.id === targetId);
        if (!connDef) throw new Error(`No default definition for connection id: ${targetId}`);
        await this.saveConnection({
            id: connDef.id,
            name: connDef.name,
            providerId: connDef.providerId,
            tiers: connDef.tiers,
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
            const result = await this.engine.driver.search({ name: { contains: '.agent' }, type: 'file' });

            const results = await Promise.all(Array.from(result.nodes).map(async (node) => {
                if (!node.name.endsWith('.agent')) return null;
                try {
                    const content = await this.engine.driver.readContent(node.path);
                    if (!content) return null;
                    const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
                    const data = JSON.parse(jsonStr) as AgentDefinition;
                    // Compat: rename legacy modelId → modelName
                    if ((data.config as any).modelId && !data.config.modelName) {
                        data.config.modelName = (data.config as any).modelId;
                    }
                    if (data.id) {
                        this._agentNodeIds.set(data.id, node.path);
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

// ─── Utils ────────────────────────────────────────────────────────────────────

/** Shallow-enough deep equal for config objects (JSON-serializable values). */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
}
