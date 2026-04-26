// @file: device-llm/device/llm-device-driver.ts
//
// LLMDeviceDriver — LLM 连接配置守护者 + LLM/MCP/Skill 通信设备。
//
// 职责：
//  1. 管理 LLMConnection 存储（VFS __config 模块 /llm/.connections/）
//  2. 管理 MCPServer 存储（VFS __config 模块 /llm/.mcp/）
//  3. 管理 LLMSkill 存储（VFS __config 模块 /llm/.skills/）
//  4. 对外暴露 ConnectionMeta（无 apiKey）供 AgentExecutor 等使用
//  5. 通过 ioctl 为 Settings UI 提供 CRUD
//  6. 维护 Chat / MCP / Skill Session 生命周期
//  7. 创建 /dev/llm/connection/<id>、/dev/llm/mcp/<id>、/dev/llm/skills/<id> 设备节点

import type {
    IDeviceDriver, ILLMManagementService,
    DeviceContext, IVFSManager, FileContent,
    LLMConnection, LLMProvider, ConnectionMeta, ChatMessage, ChatCompletionChunk,
    ChatCompletionParams, ChatCompletionResponse, TokenUsage,
    MCPServer, LLMSkill, CreateFileOptions, ToolDefinition,
    ConnectionTestResult, InitialAgentDef,
} from '@itookit/common';
import { toConnectionMeta, aggregateProviderCosts, CONFIG_MODULE } from '@itookit/common';
import yaml from 'js-yaml';

import { LLMDriver } from '../core/driver';
import { testLLMConnection } from '../core/api';
import { LLM_PROVIDERS, DEFAULT_CONNECTIONS, CONST_CONFIG_VERSION, DEFAULT_AGENTS } from '../constants';
import { MCPServerConnection, type MCPToolInfo } from '../skills/mcp-client';
import type { MCPServerConfig } from '../types/provider';

// ─── 存储路径 ────────────────────────────────────────────────────────────────
const STORAGE_MODULE   = CONFIG_MODULE;             // '__config'
const CONNECTIONS_DIR  = '/llm/.connections';       // LLM 连接（新路径）
const PROVIDERS_DIR    = '/llm/.providers';         // Provider 配置（用户自定义 + 内置覆盖）
const DEFAULTS_VERSION = '/llm/.connections_version.json';
const MCP_DIR          = '/llm/.mcp';               // MCP 服务器配置（新路径）
const SKILLS_DIR       = '/llm/.skills';            // Skill 配置

// 旧路径（数据迁移用）
const OLD_CONNECTIONS_DIR = '/_llm/.connections';
const OLD_DEFAULTS_VERSION = '/_llm/.connections_version.json';

// ─── ioctl 命令 ───────────────────────────────────────────────────────────────

export const LLM_IOCTL = {
    // ── 连接管理（无需 sessionId）────────────────────────────────────────────
    /** → ConnectionMeta[]（无 apiKey） */
    LIST_CONNECTIONS:         'list-connections',
    /** arg: id → ConnectionMeta | null */
    GET_CONNECTION_META:      'get-connection',
    /** → ConnectionMeta | null（第一个或 id='default'） */
    GET_DEFAULT_CONNECTION:   'get-default-connection',
    /** arg: id → LLMConnection | null（含 apiKey，仅供 Settings UI 编辑使用） */
    GET_FULL_CONNECTION:      'get-full-connection',
    /** arg: LLMConnection → void（保存连接，含 apiKey） */
    SAVE_CONNECTION:          'save-connection',
    /** arg: id → void */
    DELETE_CONNECTION:        'delete-connection',
    /** arg: { provider, apiKey, baseURL?, model? } → ConnectionTestResult */
    TEST_CONNECTION_PARAMS:   'test-connection-params',

    // ── MCP 服务器管理（无需 sessionId）─────────────────────────────────────
    /** → MCPServer[] */
    LIST_MCP_SERVERS:         'list-mcp-servers',
    /** arg: MCPServer → void */
    SAVE_MCP_SERVER:          'save-mcp-server',
    /** arg: id → void */
    DELETE_MCP_SERVER:        'delete-mcp-server',
    /** arg: id → void — 连接指定 MCP 服务器 */
    CONNECT_MCP_SERVER:       'connect-mcp-server',
    /** arg: id → void — 断开指定 MCP 服务器 */
    DISCONNECT_MCP_SERVER:    'disconnect-mcp-server',

    // ── Chat 会话（需要 sessionId）───────────────────────────────────────────
    CHAT:             'chat',
    CHAT_SYNC:        'chat-sync',
    GET_HISTORY:      'get-history',
    CLEAR_HISTORY:    'clear-history',
    GET_MODELS:       'get-models',
    ABORT:            'abort',
    SET_SYSTEM_PROMPT:'set-system-prompt',

    // ── MCP 会话（需要 sessionId，由 /dev/llm/mcp/<id> 打开）────────────────
    /** → ToolDefinition[] */
    MCP_LIST_TOOLS:   'list-tools',
    /** arg: { tool: string; args: Record<string,any>; timeout?: number } → any */
    MCP_CALL_TOOL:    'call-tool',

    // ── Provider 管理（无需 sessionId）──────────────────────────────────────
    /** → LLMProvider[]（不含 apiKey） */
    LIST_PROVIDERS:       'list-providers',
    /** arg: id → LLMProvider | null（不含 apiKey，含模型定价） */
    GET_PROVIDER:         'get-provider',
    /** arg: id → LLMProvider | null（含 apiKey，仅供 Settings UI） */
    GET_FULL_PROVIDER:    'get-full-provider',
    /** arg: LLMProvider → void（保存，含 apiKey） */
    SAVE_PROVIDER:        'save-provider',
    /** arg: id → void */
    DELETE_PROVIDER:      'delete-provider',

    // ── Skill 管理（无需 sessionId）──────────────────────────────────────────
    /** → LLMSkill[] */
    LIST_SKILLS:      'list-skills',
    /** arg: LLMSkill → void */
    SAVE_SKILL:       'save-skill',
    /** arg: id → void */
    DELETE_SKILL:     'delete-skill',

    // ── Skill 会话（需要 sessionId，由 /dev/llm/skills/<id> 打开）────────────
    /** arg: { args: Record<string,unknown> } → unknown — 调用 HTTP 端点 */
    SKILL_INVOKE:     'invoke',
    /** → LLMSkill — 读取当前 skill 配置 */
    SKILL_GET_DEF:    'get-definition',
} as const;

export type LLMIoctlCommand = typeof LLM_IOCTL[keyof typeof LLM_IOCTL];

// ─── 公共接口 ─────────────────────────────────────────────────────────────────

/** open() options（LLM session） */
export interface LLMDeviceOpenOptions {
    connectionId: string;
    systemPrompt?: string;
    completionDefaults?: Record<string, unknown>;
}

// ILLMManagementService 统一管理接口已定义在 @itookit/common

// ─── 内部会话状态 ─────────────────────────────────────────────────────────────

interface LLMSessionState {
    readonly kind: 'llm';
    readonly driver: LLMDriver;
    readonly connection: LLMConnection;
    readonly completionDefaults: Record<string, unknown>;
    history: ChatMessage[];
    pendingStream: AsyncGenerator<ChatCompletionChunk> | null;
    lastResponse: string | null;
    lastUsage: TokenUsage | null;
    abortController: AbortController | null;
}

interface MCPSessionState {
    readonly kind: 'mcp';
    readonly connection: MCPServerConnection;
    readonly server: MCPServer;
}

interface SkillSessionState {
    readonly kind: 'skill';
    readonly skill: LLMSkill;
}

type SessionState = LLMSessionState | MCPSessionState | SkillSessionState;

// ─── Shell Runner interface ──────────────────────────────────────────────────
//
// 执行环境隔离层。device-llm 运行在浏览器环境，不能直接访问 child_process。
// 不同宿主环境注入各自的实现：
//   - 浏览器:    不注入 → shell skills 返回"不支持"提示
//   - Tauri:     TauriShellRunner（@tauri-apps/plugin-shell）
//   - Node.js:   NodeShellRunner（由 llm-harness 提供）
//
export interface IShellRunner {
    /** 执行 shell 命令，返回 stdout+stderr 合并输出 */
    run(command: string, args: Record<string, unknown>): Promise<string>;
}

// ─── LLMDeviceDriver ─────────────────────────────────────────────────────────

export interface LLMDeviceDriverOptions {
    /**
     * Shell 命令执行器（可选）。
     * 未注入时 shell 类型 Skill 返回"环境不支持"提示。
     */
    shellRunner?: IShellRunner;
}

export class LLMDeviceDriver implements IDeviceDriver, ILLMManagementService {
    readonly handlerId = 'llm';
    readonly description = 'LLM streaming chat, connection management, MCP, and skills device';
    readonly writable = true;
    readonly streamable = true;
    readonly sessionable = true;

    // ── Provider catalog (built-in + user custom, loaded from VFS at init) ──
    private _providers: Map<string, LLMProvider> =
        new Map(Object.entries(LLM_PROVIDERS).map(([k, v]) => [k, { ...v, id: k }]));

    // ── Connection store ──
    private _connections: LLMConnection[] = [];
    private _listeners = new Set<() => void>();
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubs: Array<() => void> = [];

    // ── MCP store ──
    private _mcpServers: MCPServer[] = [];
    private _activeMCPConns = new Map<string, MCPServerConnection>();

    // ── Skill store ──
    private _skills: LLMSkill[] = [];

    // ── Sessions ──
    private readonly sessions = new Map<string, SessionState>();
    private sessionSeq = 0;

    private engine!: ReturnType<IVFSManager['getEngine']>;
    private readonly shellRunner: IShellRunner | undefined;

    constructor(private readonly vfs: IVFSManager, options?: LLMDeviceDriverOptions) {
        this.shellRunner = options?.shellRunner;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        if (!this.vfs.getModule(STORAGE_MODULE)) {
            await this.vfs.mount(STORAGE_MODULE, {
                description: 'Settings Persistence',
                isSystem: true,
            });
        }
        this.engine = this.vfs.getEngine(STORAGE_MODULE);

        // Migrate data from old paths if needed
        await this.migrateConnectionsIfNeeded();
        await this.migrateMCPIfNeeded();

        // Seed built-in providers to VFS + load user customizations
        await this.syncDefaultProviders();
        await this.reloadProviders();

        // Write default connections (incremental)
        await this.ensureDefaults();

        // Load caches
        await this.reload();
        await this.reloadMCP();
        await this.reloadSkills();

        // Cross-tab sync
        this.bindVFSEvents();
    }

    async dispose(): Promise<void> {
        this._eventUnsubs.forEach(fn => fn());
        this._eventUnsubs = [];
        if (this._syncTimer) { clearTimeout(this._syncTimer); this._syncTimer = null; }
        this._listeners.clear();

        // Abort all LLM sessions
        for (const s of this.sessions.values()) {
            if (s.kind === 'llm') s.abortController?.abort();
        }

        // Disconnect all active MCP connections
        for (const conn of this._activeMCPConns.values()) {
            try { await conn.disconnect(); } catch { /* ignore */ }
        }
        this._activeMCPConns.clear();
        this.sessions.clear();
    }

    // ─── createDeviceNodes ────────────────────────────────────────────────────

    /**
     * 在 VFS 中建立 /dev/llm/ 目录树并创建设备文件。
     *
     * /dev/llm/                  ← 普通目录
     *   connection/<id>          ← device 文件
     *   mcp/<id>                 ← device 文件
     *   skills/<id>              ← device 文件
     *
     * 调用方须先通过 vfsCore.devices.register(this) 注册驱动，
     * 不应调用 vfsCore.registerDevice(this)（会把 /dev/llm 创建为 device 文件）。
     */
    async createDeviceNodes(): Promise<void> {
        // 迁移：旧版本把 /dev/llm 创建为 device 文件，导致无法建子路径。
        // removeDeviceNode 内部 try-catch，若节点不存在或已是目录则静默忽略。
        //await this.vfs.removeDeviceNode('/dev/llm');

        // 建父目录（普通目录，不是 device 文件）
        await this.vfs.ensureSystemDirectory('/dev/llm');
        await this.vfs.ensureSystemDirectory('/dev/llm/connection');
        await this.vfs.ensureSystemDirectory('/dev/llm/mcp');
        await this.vfs.ensureSystemDirectory('/dev/llm/skills');

        // Connection device files
        for (const conn of this._connections) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/connection/${conn.id}`, {
                resourceType: 'connection',
                resourceId: conn.id,
            });
        }

        // MCP device files + auto-connect
        for (const server of this._mcpServers) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
                resourceType: 'mcp',
                resourceId: server.id,
            });
            if (server.autoConnect) {
                try {
                    await this.connectMCPServer(server);
                } catch (e) {
                    console.error(`[LLMDeviceDriver] Auto-connect MCP server '${server.id}' failed:`, e);
                }
            }
        }

        // Skill device files
        for (const skill of this._skills) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/skills/${skill.id}`, {
                resourceType: 'skill',
                resourceId: skill.id,
            });
        }
    }

    // ─── IDeviceDriver: open / close ─────────────────────────────────────────

    async open(ctx: DeviceContext, options?: Record<string, unknown>): Promise<string> {
        // 优先使用设备节点元数据（来自 /dev/llm/connection/<id> 等设备文件），
        // 其次回落到 options（直接传参，如 openDevice('/dev/llm', { resourceType: 'mcp' })）
        const resourceType = (ctx.metadata?.resourceType ?? options?.resourceType) as string | undefined;
        const resourceId   = (ctx.metadata?.resourceId   ?? options?.resourceId)   as string | undefined;

        if (resourceType === 'connection') {
            return this.openConnectionSession(resourceId ?? 'default', options);
        }
        if (resourceType === 'mcp') {
            if (!resourceId) throw new Error('LLMDeviceDriver: resourceId required for MCP session');
            return this.openMCPSession(resourceId, options);
        }
        if (resourceType === 'skill') {
            if (!resourceId) throw new Error('LLMDeviceDriver: resourceId required for Skill session');
            return this.openSkillSession(resourceId);
        }

        // Legacy: openDevice('/dev/llm', { connectionId: 'xxx' })
        const opts = options as LLMDeviceOpenOptions | undefined;
        return this.openConnectionSession(opts?.connectionId ?? 'default', options);
    }

    async close(ctx: DeviceContext): Promise<void> {
        const session = this.sessions.get(ctx.sessionId!);
        if (!session) return;

        if (session.kind === 'llm') {
            session.abortController?.abort();
        }
        this.sessions.delete(ctx.sessionId!);
    }

    // ─── IDeviceDriver: I/O ──────────────────────────────────────────────────

    async write(ctx: DeviceContext, content: FileContent): Promise<void> {
        const session = this.requireLLMSession(ctx);
        session.abortController?.abort();
        session.pendingStream = null;

        const abort = new AbortController();
        session.abortController = abort;
        session.history.push(this.decodeMessage(content));

        const rawStream = await session.driver.chat.create({
            ...session.completionDefaults,
            messages: session.history,
            stream: true,
            signal: abort.signal,
        });
        session.pendingStream = this.wrapAccumulate(session, rawStream);
    }

    async *readStream(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer> {
        const session = this.requireLLMSession(ctx);
        if (!session.pendingStream) return;
        const gen = session.pendingStream;
        session.pendingStream = null;
        for await (const chunk of gen) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) yield delta;
        }
    }

    async read(ctx: DeviceContext): Promise<FileContent> {
        const session = this.requireLLMSession(ctx);
        if (session.pendingStream) {
            const gen = session.pendingStream;
            session.pendingStream = null;
            for await (const _ of gen) { /* drain */ }
        }
        return session.lastResponse ?? '';
    }

    // ─── IDeviceDriver: ioctl ────────────────────────────────────────────────

    async ioctl(ctx: DeviceContext, command: string | number, arg?: unknown): Promise<unknown> {
        // ── 连接管理命令（无需 sessionId）──────────────────────────────────────
        switch (command) {
            case LLM_IOCTL.LIST_CONNECTIONS:
                return this._connections.map(c => this.connToMeta(c));

            case LLM_IOCTL.GET_CONNECTION_META: {
                const c = this.findConn(arg as string);
                return c ? this.connToMeta(c) : null;
            }

            case LLM_IOCTL.GET_DEFAULT_CONNECTION: {
                const c = this.defaultConnection;
                return c ? this.connToMeta(c) : null;
            }

            case LLM_IOCTL.GET_FULL_CONNECTION:
                return this.findConn(arg as string) ?? null;

            case LLM_IOCTL.SAVE_CONNECTION: {
                await this.saveConnection(arg as LLMConnection);
                return;
            }

            case LLM_IOCTL.DELETE_CONNECTION: {
                await this.deleteConnection(arg as string);
                return;
            }

            case LLM_IOCTL.TEST_CONNECTION_PARAMS:
                return testLLMConnection(arg as Parameters<typeof testLLMConnection>[0]) as Promise<ConnectionTestResult>;

            // ── MCP 管理命令（无需 sessionId）──────────────────────────────────
            case LLM_IOCTL.LIST_MCP_SERVERS:
                return this._mcpServers.slice();

            case LLM_IOCTL.SAVE_MCP_SERVER: {
                await this.saveMCPServer(arg as MCPServer);
                return;
            }

            case LLM_IOCTL.DELETE_MCP_SERVER: {
                await this.deleteMCPServer(arg as string);
                return;
            }

            case LLM_IOCTL.CONNECT_MCP_SERVER: {
                const server = this._mcpServers.find(s => s.id === (arg as string));
                if (server) await this.connectMCPServer(server);
                return;
            }

            case LLM_IOCTL.DISCONNECT_MCP_SERVER: {
                const conn = this._activeMCPConns.get(arg as string);
                if (conn) {
                    await conn.disconnect();
                    this._activeMCPConns.delete(arg as string);
                }
                return;
            }

            // ── Provider 管理命令（无需 sessionId）──────────────────────────────
            case LLM_IOCTL.LIST_PROVIDERS:
                return this.getProviders();          // strips apiKey

            case LLM_IOCTL.GET_PROVIDER:
                return this.getProvider(arg as string) ?? null;   // safe view, no apiKey

            case LLM_IOCTL.GET_FULL_PROVIDER:
                return this.getFullProvider(arg as string) ?? null;

            case LLM_IOCTL.SAVE_PROVIDER:
                await this.saveProvider(arg as LLMProvider);
                return;

            case LLM_IOCTL.DELETE_PROVIDER:
                await this.deleteProvider(arg as string);
                return;

            // ── Skill 管理命令（无需 sessionId）────────────────────────────────
            case LLM_IOCTL.LIST_SKILLS:
                return this._skills.slice();

            case LLM_IOCTL.SAVE_SKILL:
                await this.saveSkill(arg as LLMSkill);
                return;

            case LLM_IOCTL.DELETE_SKILL:
                await this.deleteSkill(arg as string);
                return;
        }

        // ── MCP / Skill 会话命令 ────────────────────────────────────────────────
        const session = this.sessions.get(ctx.sessionId!);
        if (session?.kind === 'mcp') {
            switch (command) {
                case LLM_IOCTL.MCP_LIST_TOOLS: {
                    const tools = await session.connection.listTools();
                    return tools.map((t: MCPToolInfo): ToolDefinition => ({
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description,
                            parameters: t.inputSchema,
                        },
                    }));
                }

                case LLM_IOCTL.MCP_CALL_TOOL: {
                    const { tool, args, timeout } = arg as { tool: string; args: Record<string, any>; timeout?: number };
                    return session.connection.callTool(tool, args, { timeout });
                }

                default:
                    throw new Error(`LLMDeviceDriver: unknown MCP ioctl '${String(command)}'`);
            }
        }

        if (session?.kind === 'skill') {
            switch (command) {
                case LLM_IOCTL.SKILL_GET_DEF:
                    return session.skill;

                case LLM_IOCTL.SKILL_INVOKE: {
                    const { args } = arg as { args: Record<string, unknown> };
                    return this.invokeSkill(session.skill, args);
                }

                default:
                    throw new Error(`LLMDeviceDriver: unknown Skill ioctl '${String(command)}'`);
            }
        }

        // ── LLM Chat 会话命令（需要 sessionId）─────────────────────────────────
        const llmSession = this.requireLLMSession(ctx);

        switch (command) {
            case LLM_IOCTL.CHAT: {
                const params = arg as ChatCompletionParams;
                llmSession.abortController?.abort();
                llmSession.pendingStream = null;
                const abort = new AbortController();
                params.signal?.addEventListener('abort', () => abort.abort(), { once: true });
                llmSession.abortController = abort;
                const rawStream = await llmSession.driver.chat.create({
                    ...params, stream: true, signal: abort.signal,
                });
                return this.wrapStreamOnly(rawStream, llmSession);
            }

            case LLM_IOCTL.CHAT_SYNC: {
                const params = arg as ChatCompletionParams;
                return llmSession.driver.chat.create({ ...params, stream: false }) as Promise<ChatCompletionResponse>;
            }

            case LLM_IOCTL.GET_HISTORY:
                return llmSession.history.slice();

            case LLM_IOCTL.CLEAR_HISTORY:
                llmSession.abortController?.abort();
                llmSession.pendingStream = null;
                llmSession.lastResponse = null;
                llmSession.lastUsage = null;
                llmSession.history = llmSession.history.filter(m => m.role === 'system');
                return;

            case LLM_IOCTL.GET_MODELS:
                return llmSession.connection.availableModels ?? [];

            case LLM_IOCTL.ABORT:
                llmSession.abortController?.abort();
                llmSession.pendingStream = null;
                return;

            case LLM_IOCTL.SET_SYSTEM_PROMPT: {
                const prompt = arg as string | undefined;
                llmSession.history = llmSession.history.filter(m => m.role !== 'system');
                if (prompt) llmSession.history.unshift({ role: 'system', content: prompt });
                return;
            }

            default:
                throw new Error(`LLMDeviceDriver: unknown ioctl '${String(command)}'`);
        }
    }

    // ─── IConnectionService ───────────────────────────────────────────────────

    async getConnections(): Promise<ConnectionMeta[]> {
        return this._connections.map(c => this.connToMeta(c));
    }

    async getConnection(id: string): Promise<ConnectionMeta | undefined> {
        const c = this.findConn(id);
        return c ? this.connToMeta(c) : undefined;
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        const c = this.defaultConnection;
        return c ? toConnectionMeta(c) : null;
    }

    async getFullConnection(id: string): Promise<LLMConnection | null> {
        return this.findConn(id) ?? null;
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        await this.writeToDisk(conn);
        // Update in-memory cache directly; bindVFSEvents debounce handles cross-tab sync
        const idx = this._connections.findIndex(c => c.id === conn.id);
        if (idx >= 0) { this._connections[idx] = conn; } else { this._connections.push(conn); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/connection/${conn.id}`, {
            resourceType: 'connection',
            resourceId: conn.id,
        });
        this.notify();

        // Aggregate connection costs into provider dailyCosts
        if (conn.dailyCosts && conn.providerId) {
            this.aggregateAndSaveProviderCosts(conn.providerId).catch(() => {});
        }
    }

    /** 聚合指定 Provider 下所有 Connection 的 dailyCosts，写入 Provider */
    private async aggregateAndSaveProviderCosts(providerId: string): Promise<void> {
        const provider = this._providers.get(providerId);
        if (!provider) return;
        const pid = providerId;
        const sameProviderConns = this._connections.filter(
            c => (c.providerId ?? c.provider) === pid
        );
        provider.dailyCosts = aggregateProviderCosts(sameProviderConns);
        await this.saveProvider(provider);
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === 'default') throw new Error('Cannot delete the default connection');
        await this.deleteFromDisk(id);
        this._connections = this._connections.filter(c => c.id !== id);
        await this.vfs.removeDeviceNode(`/dev/llm/connection/${id}`);
        this.notify();
    }

    onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    // ─── ILLMManagementService — MCP ─────────────────────────────────────────

    async getMCPServers(): Promise<MCPServer[]> {
        return [...this._mcpServers];
    }

    async saveMCPServer(server: MCPServer): Promise<void> {
        await this.writeMCPToDisk(server);
        const idx = this._mcpServers.findIndex(s => s.id === server.id);
        if (idx >= 0) { this._mcpServers[idx] = server; } else { this._mcpServers.push(server); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
            resourceType: 'mcp',
            resourceId: server.id,
        });
        this.notify();
    }

    async deleteMCPServer(id: string): Promise<void> {
        await this.deleteMCPFromDisk(id);
        this._mcpServers = this._mcpServers.filter(s => s.id !== id);
        const conn = this._activeMCPConns.get(id);
        if (conn) {
            try { await conn.disconnect(); } catch { /* ignore */ }
            this._activeMCPConns.delete(id);
        }
        await this.vfs.removeDeviceNode(`/dev/llm/mcp/${id}`);
        this.notify();
    }

    // ─── Provider storage ─────────────────────────────────────────────────────

    /**
     * 将内置 Provider 写入 VFS（首次）。已存在的条目保持不变（用户修改受保护）。
     */
    private async syncDefaultProviders(): Promise<void> {
        const existing = await this.loadJsonFilesFromDir<LLMProvider>(PROVIDERS_DIR);
        const existingIds = new Set(existing.map(p => p.id));
        for (const [key, def] of Object.entries(LLM_PROVIDERS)) {
            if (!existingIds.has(key)) {
                await this.writeProviderToDisk({ ...def, id: key, isBuiltin: true });
            }
        }
    }

    private async reloadProviders(): Promise<void> {
        const fromVFS = await this.loadJsonFilesFromDir<LLMProvider>(PROVIDERS_DIR);
        // Start with built-in defaults, overlay VFS data (user customizations win)
        const merged = new Map(Object.entries(LLM_PROVIDERS).map(([k, v]) => [k, { ...v, id: k }]));
        for (const p of fromVFS) {
            merged.set(p.id, p);
        }
        this._providers = merged;
    }

    async saveProvider(provider: LLMProvider): Promise<void> {
        await this.writeProviderToDisk(provider);
        this._providers.set(provider.id, provider);
        this.notify();
    }

    async deleteProvider(id: string): Promise<void> {
        const provider = this._providers.get(id);
        if (provider?.isBuiltin) throw new Error(`Cannot delete built-in provider: ${id}`);
        await this.deleteProviderFromDisk(id);
        this._providers.delete(id);
        this.notify();
    }

    private async writeProviderToDisk(provider: LLMProvider): Promise<void> {
        await this.engineUpsert(
            `${PROVIDERS_DIR}/${provider.id}.json`,
            JSON.stringify(provider, null, 2),
        );
    }

    private async deleteProviderFromDisk(id: string): Promise<void> {
        const nodeId = await this.engine.resolvePath(`${PROVIDERS_DIR}/${id}.json`);
        if (nodeId) await this.engine.delete([nodeId]);
    }

    // ─── Connection storage ───────────────────────────────────────────────────

    private async ensureDefaults(): Promise<void> {
        try {
            const ver = await this.readJson<{ version: number }>(DEFAULTS_VERSION);
            if (ver && ver.version >= CONST_CONFIG_VERSION) return;
            await this.syncDefaultConnections();
            await this.writeJson(DEFAULTS_VERSION, { version: CONST_CONFIG_VERSION, updatedAt: Date.now() });
        } catch (e) {
            console.error('[LLMDeviceDriver] ensureDefaults failed', e);
        }
    }

    private async syncDefaultConnections(): Promise<void> {
        const current = await this.loadAll();
        const byId = new Map(current.map(c => [c.id, c]));

        for (const def of DEFAULT_CONNECTIONS) {
            const existing = byId.get(def.id);
            if (!existing) {
                await this.writeToDisk({
                    id: def.id,
                    name: def.name,
                    providerId: def.providerId,
                    tiers: def.tiers,
                    metadata: { isSystemDefault: true },
                });
            } else {
                const updated: LLMConnection = JSON.parse(JSON.stringify(existing));
                let dirty = false;
                // Migrate: ensure providerId is set (old data had only provider)
                if (!updated.providerId && updated.provider) {
                    updated.providerId = updated.provider;
                    dirty = true;
                }
                // Back-fill tiers if missing
                if (!updated.tiers && def.tiers) {
                    updated.tiers = def.tiers;
                    dirty = true;
                }
                // Drop deprecated fields
                if (updated.availableModels !== undefined) {
                    delete updated.availableModels;
                    dirty = true;
                }
                if (dirty) await this.writeToDisk(updated);
            }
        }
    }

    private async reload(): Promise<void> {
        this._connections = await this.loadAll();
    }

    private async loadAll(): Promise<LLMConnection[]> {
        const raw = await this.loadJsonFilesFromDir<LLMConnection>(CONNECTIONS_DIR);
        return raw.map(c => this.normalizeConn(c));
    }

    private async writeToDisk(conn: LLMConnection): Promise<void> {
        await this.engineUpsert(
            `${CONNECTIONS_DIR}/${conn.id}.json`,
            JSON.stringify(conn, null, 2),
        );
    }

    private async deleteFromDisk(id: string): Promise<void> {
        const nodeId = await this.engine.resolvePath(`${CONNECTIONS_DIR}/${id}.json`);
        if (nodeId) await this.engine.delete([nodeId]);
    }

    // ─── ILLMManagementService — Skills ──────────────────────────────────────

    async getSkills(): Promise<LLMSkill[]> {
        return [...this._skills];
    }

    async saveSkill(skill: LLMSkill): Promise<void> {
        skill = { ...skill, modifiedAt: Date.now() };
        await this.writeSkillToDisk(skill);
        const idx = this._skills.findIndex(s => s.id === skill.id);
        if (idx >= 0) { this._skills[idx] = skill; } else { this._skills.push(skill); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/skills/${skill.id}`, {
            resourceType: 'skill',
            resourceId: skill.id,
        });
        this.notify();
    }

    async deleteSkill(id: string): Promise<void> {
        await this.deleteSkillFromDisk(id);
        this._skills = this._skills.filter(s => s.id !== id);
        await this.vfs.removeDeviceNode(`/dev/llm/skills/${id}`);
        this.notify();
    }

    // ─── ILLMManagementService — Defaults metadata ────────────────────────────

    getConfigVersion(): number {
        return CONST_CONFIG_VERSION;
    }

    getDefaultAgents(): InitialAgentDef[] {
        return DEFAULT_AGENTS;
    }

    getDefaultConnections() {
        return DEFAULT_CONNECTIONS;
    }

    // ─── IConnectionService — Provider metadata & testing ─────────────────────

    getProviderDefaults(): Record<string, LLMProvider> {
        return LLM_PROVIDERS;
    }

    /** 获取单个 Provider 定义 */
    getProvider(providerId: string): LLMProvider | undefined {
        const p = this._providers.get(providerId);
        if (!p) return undefined;
        return this.stripProviderApiKey(p);
    }

    /** 列出所有 Provider（不含 apiKey，供 UI 列表使用） */
    getProviders(): LLMProvider[] {
        return [...this._providers.values()].map(p => this.stripProviderApiKey(p));
    }

    /** 返回含 apiKey 的完整 Provider（仅供 Settings UI 编辑表单使用） */
    getFullProvider(id: string): LLMProvider | undefined {
        return this._providers.get(id);
    }

    /** 剥离 apiKey，返回安全的 Provider 视图 */
    private stripProviderApiKey(provider: LLMProvider): LLMProvider {
        const { apiKey: _apiKey, ...meta } = provider as LLMProvider & { apiKey?: string };
        return meta as LLMProvider;
    }

    // saveProvider / deleteProvider are implemented in the Provider storage section above.

    async testConnection(params: { provider: string; apiKey: string; baseURL?: string; model?: string }): Promise<ConnectionTestResult> {
        return testLLMConnection(params);
    }

    // ─── MCP storage ──────────────────────────────────────────────────────────

    private async reloadMCP(): Promise<void> {
        this._mcpServers = await this.loadAllMCP();
    }

    private async loadAllMCP(): Promise<MCPServer[]> {
        return this.loadJsonFilesFromDir<MCPServer>(MCP_DIR);
    }

    private async writeMCPToDisk(server: MCPServer): Promise<void> {
        await this.engineUpsert(
            `${MCP_DIR}/${server.id}.json`,
            JSON.stringify(server, null, 2),
        );
    }

    private async deleteMCPFromDisk(id: string): Promise<void> {
        const nodeId = await this.engine.resolvePath(`${MCP_DIR}/${id}.json`);
        if (nodeId) await this.engine.delete([nodeId]);
    }

    // ─── MCP connection management ────────────────────────────────────────────

    private async connectMCPServer(server: MCPServer): Promise<void> {
        if (this._activeMCPConns.has(server.id)) return; // already connected

        const config = this.mcpServerToConfig(server);
        const conn = new MCPServerConnection(config);
        await conn.connect();
        this._activeMCPConns.set(server.id, conn);
    }

    /** Convert MCPServer (common) → MCPServerConfig (local transport layer) */
    private mcpServerToConfig(server: MCPServer): MCPServerConfig {
        const transport = server.transport === 'http' ? 'sse' : server.transport as 'stdio' | 'sse';
        return {
            name: server.name,
            transport,
            command: server.command,
            args: server.args ? server.args.trim().split(/\s+/).filter(Boolean) : undefined,
            url: server.endpoint,
        };
    }

    // ─── Skill storage ────────────────────────────────────────────────────────

    private async reloadSkills(): Promise<void> {
        this._skills = await this.loadAllSkills();
    }

    private loadAllSkills(): Promise<LLMSkill[]> {
        return this.loadJsonFilesFromDir<LLMSkill>(SKILLS_DIR);
    }

    private async writeSkillToDisk(skill: LLMSkill): Promise<void> {
        await this.engineUpsert(
            `${SKILLS_DIR}/${skill.id}.yaml`,
            yaml.dump(skill, { lineWidth: -1, noRefs: true }),
        );
        // Remove legacy .json file if present (one-time migration on first save).
        const oldId = await this.engine.resolvePath(`${SKILLS_DIR}/${skill.id}.json`);
        if (oldId) await this.engine.delete([oldId]);
    }

    private async deleteSkillFromDisk(id: string): Promise<void> {
        for (const ext of ['.yaml', '.json']) {
            const nodeId = await this.engine.resolvePath(`${SKILLS_DIR}/${id}${ext}`);
            if (nodeId) { await this.engine.delete([nodeId]); break; }
        }
    }

    // ─── Session management ───────────────────────────────────────────────────

    private async openConnectionSession(
        connectionId: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const opts = options as LLMDeviceOpenOptions | undefined;
        const conn = this.findConn(connectionId)
            ?? this.findConn('default')
            ?? this._connections[0];

        if (!conn) {
            throw new Error(`LLMDeviceDriver: no connection available for id '${connectionId}'`);
        }
        if (conn.enabled === false) {
            throw new Error(`LLMDeviceDriver: connection '${conn.id}' is disabled`);
        }
        // apiKey now lives on Provider; fall back to legacy conn.apiKey for old data
        const provider = this.getProviderForConn(conn);
        if (provider?.enabled === false) {
            throw new Error(`LLMDeviceDriver: provider '${conn.providerId ?? conn.provider}' is disabled`);
        }
        const apiKey = provider?.apiKey?.trim() ?? conn.apiKey?.trim();
        if (!apiKey) {
            throw new Error(
                `LLMDeviceDriver: provider '${conn.providerId ?? conn.provider}' has no API key configured`
            );
        }

        // Resolve model from provider catalog + tier mapping
        // Tier config lives on Connection; Provider has no defaultTiers.
        const effectiveTiers = conn.tiers;
        const resolvedModel =
            effectiveTiers?.optimal
            ?? conn.model                   // legacy fallback
            ?? provider?.models[0]?.id
            ?? '';

        // Build a connection object for LLMDriver (which reads .provider, .apiKey, .model)
        const connForDriver: LLMConnection = {
            ...conn,
            provider: conn.providerId ?? conn.provider ?? '',  // LLMDriver reads `provider`
            apiKey,                                            // resolved from provider
            model: resolvedModel,
        };

        const driver = new LLMDriver({ connection: connForDriver });
        const history: ChatMessage[] = opts?.systemPrompt
            ? [{ role: 'system', content: opts.systemPrompt }]
            : [];

        const sessionId = `llm-${++this.sessionSeq}`;
        this.sessions.set(sessionId, {
            kind: 'llm',
            driver,
            connection: conn,
            completionDefaults: (opts?.completionDefaults ?? {}) as Record<string, unknown>,
            history,
            pendingStream: null,
            lastResponse: null,
            lastUsage: null,
            abortController: null,
        });
        return sessionId;
    }

    private async openMCPSession(
        serverId: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        const server = this._mcpServers.find(s => s.id === serverId);
        if (!server) {
            throw new Error(`LLMDeviceDriver: MCP server '${serverId}' not found`);
        }

        // Connect if not already connected
        if (!this._activeMCPConns.has(serverId)) {
            await this.connectMCPServer(server);
        }

        const conn = this._activeMCPConns.get(serverId)!;
        const sessionId = `mcp-${++this.sessionSeq}`;
        this.sessions.set(sessionId, {
            kind: 'mcp',
            connection: conn,
            server,
        });
        return sessionId;
    }

    private openSkillSession(skillId: string): string {
        const skill = this._skills.find(s => s.id === skillId);
        if (!skill) throw new Error(`LLMDeviceDriver: skill '${skillId}' not found`);
        const sessionId = `skill-${++this.sessionSeq}`;
        this.sessions.set(sessionId, { kind: 'skill', skill });
        return sessionId;
    }

    private async invokeSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        switch (skill.type) {
            case 'http':
                return this.invokeHttpSkill(skill, args);
            case 'shell':
                return this.invokeShellSkill(skill, args);
            case 'mcp':
                return this.invokeMcpSkill(skill, args);
            case 'prompt':
                return `[Skill '${skill.name}' provides context instructions — it is not a callable tool.]`;
            default:
                throw new Error(`Skill '${skill.id}': type '${skill.type}' is not invocable`);
        }
    }

    private async invokeHttpSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        if (!skill.endpoint) throw new Error(`Skill '${skill.id}' has no endpoint configured`);
        const response = await fetch(skill.endpoint, {
            method: skill.method ?? 'POST',
            headers: { 'Content-Type': 'application/json', ...skill.headers },
            body: JSON.stringify(args),
        });
        if (!response.ok) throw new Error(`Skill '${skill.name}' invocation failed: HTTP ${response.status}`);
        const ct = response.headers.get('content-type') ?? '';
        return ct.includes('application/json') ? response.json() : response.text();
    }

    private async invokeShellSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<string> {
        if (!skill.command) throw new Error(`Skill '${skill.id}' has no command configured`);
        if (!this.shellRunner) {
            return (
                `Shell skills require a native execution environment.\n` +
                `Inject an IShellRunner when constructing LLMDeviceDriver, or use the harness path.`
            );
        }
        return this.shellRunner.run(skill.command, args);
    }

    private async invokeMcpSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        const { mcpServerId, mcpToolName } = skill;
        if (!mcpServerId || !mcpToolName) {
            throw new Error(`MCP skill '${skill.id}' requires mcpServerId and mcpToolName`);
        }

        // Reuse existing connection, or open a new one for this server.
        let conn = this._activeMCPConns.get(mcpServerId);
        if (!conn) {
            const server = this._mcpServers.find(s => s.id === mcpServerId);
            if (!server) throw new Error(`MCP server '${mcpServerId}' not configured`);
            const config = this.mcpServerToConfig(server);
            conn = new MCPServerConnection(config);
            await conn.connect();
            this._activeMCPConns.set(mcpServerId, conn);
        }

        const result = await conn.callTool(mcpToolName, args);
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    // ─── Data migration ───────────────────────────────────────────────────────

    /** Migrate connections from old /_llm/.connections to /llm/.connections */
    private async migrateConnectionsIfNeeded(): Promise<void> {
        try {
            // Skip if new path already has data
            const newDirId = await this.engine.resolvePath(CONNECTIONS_DIR);
            if (newDirId) {
                const children = await this.engine.getChildren(newDirId);
                if (children.some(c => c.type === 'file' && c.name.endsWith('.json'))) return;
            }

            // Check old path
            const oldDirId = await this.engine.resolvePath(OLD_CONNECTIONS_DIR);
            if (!oldDirId) return;

            console.info('[LLMDeviceDriver] Migrating connections from old path...');
            const children = await this.engine.getChildren(oldDirId);
            for (const child of children) {
                if (child.type !== 'file' || !child.name.endsWith('.json')) continue;
                try {
                    const raw = await this.engine.readContent(child.id);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    await this.engineUpsert(`${CONNECTIONS_DIR}/${child.name}`, text);
                } catch { /* skip */ }
            }

            // Migrate version file
            const oldVer = await this.readJson<object>(OLD_DEFAULTS_VERSION);
            if (oldVer) await this.writeJson(DEFAULTS_VERSION, oldVer);

            console.info('[LLMDeviceDriver] Connection migration complete.');
        } catch (e) {
            console.error('[LLMDeviceDriver] Migration failed:', e);
        }
    }

    /** Migrate MCP servers from agents:/.mcp to /llm/.mcp */
    private async migrateMCPIfNeeded(): Promise<void> {
        try {
            // Skip if new path already has data
            const newDirId = await this.engine.resolvePath(MCP_DIR);
            if (newDirId) {
                const children = await this.engine.getChildren(newDirId);
                if (children.some(c => c.type === 'file' && c.name.endsWith('.json'))) return;
            }

            // Try to read from agents module
            const agentsModule = 'agents';
            if (!this.vfs.getModule(agentsModule)) return;

            const agentsEngine = this.vfs.getEngine(agentsModule);
            const oldMcpDirId = await agentsEngine.resolvePath('/.mcp');
            if (!oldMcpDirId) return;

            console.info('[LLMDeviceDriver] Migrating MCP servers from agents module...');
            const children = await agentsEngine.getChildren(oldMcpDirId);
            for (const child of children) {
                if (child.type !== 'file' || !child.name.endsWith('.json')) continue;
                try {
                    const raw = await agentsEngine.readContent(child.id);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    await this.engineUpsert(`${MCP_DIR}/${child.name}`, text);
                } catch { /* skip */ }
            }
            console.info('[LLMDeviceDriver] MCP migration complete.');
        } catch (e) {
            console.error('[LLMDeviceDriver] MCP migration failed:', e);
        }
    }

    // ─── VFS event binding ────────────────────────────────────────────────────

    private bindVFSEvents(): void {
        const debounce = () => {
            if (this._syncTimer) clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(async () => {
                await this.reload();
                await this.reloadMCP();
                await this.reloadSkills();
                this.notify();
            }, 300);
        };
        this._eventUnsubs.push(
            this.engine.on('node:created', debounce),
            this.engine.on('node:updated', debounce),
            this.engine.on('node:deleted', debounce),
        );
    }

    private notify(): void {
        this._listeners.forEach(l => { try { l(); } catch { /* suppress */ } });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private findConn(id: string): LLMConnection | undefined {
        return this._connections.find(c => c.id === id);
    }

    private get defaultConnection(): LLMConnection | undefined {
        return this.findConn('default') ?? this._connections[0];
    }

    /** 从 connection 的 providerId（或旧 provider 字段）查找对应的 LLMProvider */
    private getProviderForConn(conn: LLMConnection): LLMProvider | undefined {
        const pid = conn.providerId ?? conn.provider ?? '';
        return this._providers.get(pid);
    }

    /**
     * LLMConnection → ConnectionMeta（注入 provider 解析 model + tiers）。
     * 所有对外暴露 ConnectionMeta 的地方都应通过此方法，而非直接调用 toConnectionMeta()。
     */
    private connToMeta(conn: LLMConnection): ConnectionMeta {
        return toConnectionMeta(conn, this.getProviderForConn(conn));
    }

    /**
     * 加载后对旧格式 LLMConnection 数据做规范化（向后兼容迁移）：
     * - provider → providerId
     */
    private normalizeConn(raw: LLMConnection): LLMConnection {
        if (!raw.providerId && raw.provider) {
            return { ...raw, providerId: raw.provider };
        }
        return raw;
    }

    private requireLLMSession(ctx: DeviceContext): LLMSessionState {
        const s = this.sessions.get(ctx.sessionId!);
        if (!s || s.kind !== 'llm') {
            throw new Error(`LLMDeviceDriver: LLM session '${ctx.sessionId}' not found`);
        }
        return s;
    }

    private decodeMessage(content: FileContent): ChatMessage {
        const text = typeof content === 'string'
            ? content
            : new TextDecoder().decode(content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer));
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.role === 'string' && parsed.content !== undefined) {
                return parsed as ChatMessage;
            }
        } catch { /* treat as plain text */ }
        return { role: 'user', content: text };
    }

    private async readJson<T>(path: string): Promise<T | null> {
        try {
            const nodeId = await this.engine.resolvePath(path);
            if (!nodeId) return null;
            const raw = await this.engine.readContent(nodeId);
            const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            return JSON.parse(text) as T;
        } catch { return null; }
    }

    private writeJson(path: string, data: unknown): Promise<void> {
        return this.engineUpsert(path, JSON.stringify(data, null, 2));
    }

    private async engineUpsert(path: string, content: string): Promise<void> {
        const nodeId = await this.engine.resolvePath(path);
        if (nodeId) {
            await this.engine.writeContent(nodeId, content);
        } else {
            const name = path.substring(path.lastIndexOf('/') + 1);
            const parent = path.substring(0, path.lastIndexOf('/')) || '/';
            await this.engine.createFile({
                name,
                parentIdOrPath: parent,
                content,
                recursive: true,
            } as CreateFileOptions);
        }
    }

    /** Load all YAML (preferred) and JSON (legacy) files from a VFS directory. */
    private async loadJsonFilesFromDir<T>(dirPath: string): Promise<T[]> {
        const items: T[] = [];
        try {
            const dirId = await this.engine.resolvePath(dirPath);
            if (!dirId) return [];
            const children = await this.engine.getChildren(dirId);
            for (const child of children) {
                if (child.type !== 'file') continue;
                const isYaml = child.name.endsWith('.yaml') || child.name.endsWith('.yml');
                const isJson = child.name.endsWith('.json');
                if (!isYaml && !isJson) continue;
                try {
                    const raw = await this.engine.readContent(child.id);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    const parsed = isYaml
                        ? yaml.load(text) as T
                        : JSON.parse(text) as T;
                    items.push(parsed);
                } catch { /* skip malformed */ }
            }
        } catch { /* directory not yet created */ }
        return items;
    }

    /** 有状态包装：耗尽时将 assistant 响应写入 history */
    private async *wrapAccumulate(session: LLMSessionState, gen: AsyncGenerator<ChatCompletionChunk>): AsyncGenerator<ChatCompletionChunk> {
        const parts: string[] = [];
        let usage: TokenUsage | null = null;
        try {
            for await (const chunk of gen) {
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) parts.push(delta);
                if (chunk.usage) usage = chunk.usage;
                yield chunk;
            }
        } finally {
            const response = parts.join('');
            if (response) {
                session.history.push({ role: 'assistant', content: response });
                session.lastResponse = response;
            }
            if (usage) session.lastUsage = usage;
            session.abortController = null;
        }
    }

    /** 无状态包装：不写 history（CHAT ioctl 使用） */
    private async *wrapStreamOnly(gen: AsyncGenerator<ChatCompletionChunk>, session: LLMSessionState): AsyncGenerator<ChatCompletionChunk> {
        try {
            for await (const chunk of gen) {
                if (chunk.usage) session.lastUsage = chunk.usage;
                yield chunk;
            }
        } finally {
            session.abortController = null;
        }
    }
}
