import { createFileSystemSource, MemoryBackend, type FileSystemSourceOwner } from '@itookit/vfs-core';
import { LLM_PROVIDERS } from '@itookit/device-llm';
import { ENTITY_ICONS, t, type MCPServer, type IConnectionService, type ToolMeta, type ToolDefinition } from '@itookit/common';

export interface ToolboxTool { id: string; name: string; description: string; source: string; serverId?: string; enabled: boolean; parameters?: unknown }
interface Catalog { listTools(): ToolMeta[]; getToolDefinitions(): ToolDefinition[] }

/** A read-only projection of registered tools and discovered MCP capabilities. */
export class ToolboxInventory {
    private readonly backends = { mcp: new MemoryBackend(), tools: new MemoryBackend(), providers: new MemoryBackend(), connections: new MemoryBackend() };
    private owners: Partial<Record<'mcp' | 'tools' | 'providers' | 'connections', FileSystemSourceOwner>> = {};
    readonly providers = new Map<string, { id: string; name: string; icon?: string; enabled: boolean; configured: boolean }>();
    readonly connections = new Map<string, { providerId: string; enabled: boolean }>();
    readonly tools = new Map<string, ToolboxTool>();
    constructor(private readonly servers: () => Promise<MCPServer[]>, private readonly catalog: Catalog, private readonly models?: IConnectionService) {}
    async init(): Promise<void> {
        try {
            for (const kind of ['mcp', 'tools', 'providers', 'connections'] as const) this.owners[kind] = await createFileSystemSource({
                backend: this.backends[kind], viewId: 'toolbox:' + kind, access: 'ro' });
            await this.refresh();
        } catch (error) { await this.dispose(); throw error; }
    }
    get sources() { return { mcp: this.owners.mcp!.fs, tools: this.owners.tools!.fs, providers: this.owners.providers!.fs, connections: this.owners.connections!.fs }; }

    async refresh(): Promise<void> {
        const servers = await this.servers();
        await this.refreshModels();
        this.tools.clear();
        const definitions = this.catalog.getToolDefinitions();
        for (const meta of this.catalog.listTools()) {
            const definition = definitions.find(item => (item.function?.name ?? item.name) === meta.id);
            const id = 'builtin:' + meta.id;
            this.tools.set(id, { id, name: meta.name || meta.id, description: meta.description, enabled: meta.enabled,
                source: t(meta.type === 'plugin' ? 'toolbox.plugin' : 'toolbox.builtin'), parameters: definition?.function?.parameters ?? definition?.parameters });
        }
        for (const server of servers) this.addMCPTools(server);
        await this.replace('mcp', servers.map(server => ({ id: server.id, name: server.name, description: server.description ?? '',
            source: server.transport, icon: ENTITY_ICONS.mcp, status: server.status ?? 'idle' })));
        await this.replace('tools', [...this.tools.values()].map(tool => ({ ...tool, icon: ENTITY_ICONS.tool })));
    }
    private async refreshModels(): Promise<void> {
        const providers = this.models?.getProviders() ?? [];
        const connections = await this.models?.getConnections() ?? [];
        this.providers.clear(); this.connections.clear();
        for (const item of providers) this.providers.set(item.id, { id: item.id, name: item.name,
            icon: item.icon === LLM_PROVIDERS[item.id]?.icon ? undefined : item.icon, enabled: item.enabled !== false,
            configured: item.id === 'codex' || !!this.models?.getFullProvider(item.id)?.apiKey?.trim() });
        for (const item of connections) this.connections.set(item.id, { providerId: item.providerId, enabled: item.enabled !== false });
        await this.replace('providers', providers.map(item => ({ id: item.id, name: item.name,
            description: item.baseURL ?? '', source: item.implementation, icon: item.icon ?? ENTITY_ICONS.llm })));
        await this.replace('connections', connections.map(item => ({
            id: item.id, name: item.name, description: Object.values(item.tiers ?? {}).join(' · '),
            source: providers.find(provider => provider.id === item.providerId)?.name ?? item.providerId, icon: ENTITY_ICONS.model })));
    }
    private addMCPTools(server: MCPServer): void {
        for (const raw of server.tools ?? []) {
            if (!raw || typeof raw !== 'object' || !('name' in raw) || typeof raw.name !== 'string') continue;
            const item = raw as { name: string; description?: string; inputSchema?: unknown };
            const id = `mcp:${server.id}:${item.name}`;
            this.tools.set(id, { id, name: item.name, description: item.description ?? '', source: server.name,
                serverId: server.id, enabled: server.status === 'connected', parameters: item.inputSchema });
        }
    }
    private async replace(kind: 'mcp' | 'tools' | 'providers' | 'connections', entries: Array<{ id: string; name: string; description: string; source: string; icon: string }>): Promise<void> {
        const backend = this.backends[kind], paths = new Set(entries.map(item => '/' + encodeURIComponent(item.id)));
        for (const old of await backend.list('/')) if (!paths.has(old.path)) await backend.delete(old.path);
        for (const item of entries) {
            const path = '/' + encodeURIComponent(item.id);
            await backend.write(path, new TextEncoder().encode(JSON.stringify(item)));
            await backend.updateMetadata(path, { title: item.name, description: item.description, source: item.source,
                icon: item.icon, _readOnly: true, _showAll: true });
        }
    }
    async dispose(): Promise<void> { for (const owner of Object.values(this.owners ?? {})) await owner.dispose(); }
}
