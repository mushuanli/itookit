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
    ILLMManagementService,
    LLMConnection, LLMProvider, ConnectionMeta, ChatMessage, ChatCompletionChunk,
    ChatCompletionParams, ChatCompletionResponse, TokenUsage,
    MCPServer, LLMSkill, ToolDefinition,
    ConnectionTestResult, InitialAgentDef,
} from '@itookit/common';
import type {
    IDeviceDriver, DeviceContext, IVFSManager, FileContent, IModuleFS,
} from '@itookit/vfs-core';

import { LLMDriver } from '../core/driver';
import { testLLMConnection } from '../core/api';
import { CONST_CONFIG_VERSION, DEFAULT_AGENTS, DEFAULT_CONNECTIONS } from '../constants';
import { CostStore } from '../cost/cost-store';
import type { MCPToolInfo } from '../skills/mcp-client';

import { VFSHelpers } from './vfs-helpers';
import { MigrationHelper } from './migration-helper';
import { CostManager } from './cost-manager';
import { ProviderManager } from './provider-manager';
import { ConnectionManager } from './connection-manager';
import { MCPManager } from './mcp-manager';
import { SkillManager } from './skill-manager';

// ─── 存储路径 ────────────────────────────────────────────────────────────────
const STORAGE_MODULE   = 'etc';                // /etc directory (rootfs built-in)
const CONNECTIONS_DIR  = '/llm/.connections';       // LLM 连接（新路径）
const PROVIDERS_DIR    = '/llm/.providers';         // Provider 配置（用户自定义 + 内置覆盖）
const MCP_DIR          = '/llm/.mcp';               // MCP 服务器配置（新路径）
const SKILLS_DIR       = '/llm/.skills';            // Skill 配置

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

    // ── Cost 查询（无需 sessionId）───────────────────────────────────────────
    /** arg: sessionId → CostRecord[] */
    QUERY_COSTS_BY_SESSION:  'query-costs-by-session',
    /** arg: { providerId, dateFrom?, dateTo? } → CostRecord[] */
    QUERY_COSTS_BY_PROVIDER: 'query-costs-by-provider',
    /** arg: { dateFrom?, dateTo?, providerId? } → CostRecord[] */
    QUERY_COSTS_ALL:         'query-costs-all',

    // ── Skill 会话（需要 sessionId，由 /dev/llm/skills/<id> 打开）────────────
    /** arg: { args: Record<string,unknown> } → unknown — 调用 HTTP 端点 */
    SKILL_INVOKE:     'invoke',
    /** → LLMSkill — 读取当前 skill 配置 */
    SKILL_GET_DEF:    'get-definition',
} as const;

export type LLMIoctlCommand = typeof LLM_IOCTL[keyof typeof LLM_IOCTL];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Replace path separators and other problematic chars for a log-friendly filename */
function sanitizeLabel(label: string): string {
    return label
        .replace(/[\\/]/g, '_')   // / and \ → _
        .replace(/[^a-zA-Z0-9_.-]/g, '_') // other special chars → _
        .replace(/_+/g, '_')       // collapse runs
        .replace(/^_|_$/g, '')     // trim leading/trailing _
        .slice(0, 80);             // cap length
}

// ─── 公共接口 ─────────────────────────────────────────────────────────────────

/** open() options（LLM session） */
export interface LLMDeviceOpenOptions {
    connectionId: string;
    systemPrompt?: string;
    completionDefaults?: Record<string, unknown>;
    /** 调用方的运行模式；kernel 强制走 anthropic-messages 协议。 */
    runMode?: 'kernel' | 'kernel';
    /** 日志文件名标签（如聊天文件名），将转义后用于 /var/log/llm/{label}.json */
    sessionLabel?: string;
}

// ILLMManagementService 统一管理接口已定义在 @itookit/common

// ─── 内部会话状态 ─────────────────────────────────────────────────────────────

interface LLMSessionState {
    readonly id: string;
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
    readonly connection: import('../skills/mcp-client').MCPServerConnection;
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
//   - Node.js:   NodeShellRunner（由 coreutils 提供）
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

    /**
     * LLM 流量日志记录器（可选）。
     * Web 环境注入 NoopLLMLogger，Tauri 环境注入 FileLogger。
     */
    llmLogger?: import('@itookit/common').ILLMLogger;
}

export class LLMDeviceDriver implements IDeviceDriver, ILLMManagementService {
    readonly handlerId = 'llm';
    readonly description = 'LLM streaming chat, connection management, MCP, and skills device';
    readonly writable = true;
    readonly streamable = true;
    readonly sessionable = true;

    // ── Sessions ──
    private readonly sessions = new Map<string, SessionState>();
    private sessionSeq = 0;

    // ── Listener / timer state ──
    private _listeners = new Set<() => void>();
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubs: Array<() => void> = [];

    private engine!: ReturnType<IVFSManager['getEngine']>;
    private readonly shellRunner: IShellRunner | undefined;
    private readonly llmLogger: import('@itookit/common').ILLMLogger | undefined;

    // ── Managers (initialised in init()) ──
    private vfsHelpers!: VFSHelpers;
    private migrationHelper!: MigrationHelper;
    private costManager!: CostManager;
    private providerManager!: ProviderManager;
    private connectionManager!: ConnectionManager;
    private mcpManager!: MCPManager;
    private skillManager!: SkillManager;

    /**
     * Resolve the system access for /etc hidden-file operations.
     * Prefers ctx.systemAccess (injected by openDevice) over the local engine.
     */
    private getSystemFS(_ctx?: DeviceContext): IModuleFS {
        // ctx.systemAccess is ISystemAccess but for internal consumers that need
        // IModuleFS, fall back to the local etc engine (which writes to /etc/).
        return this.engine;
    }

    constructor(private readonly vfs: IVFSManager, options?: LLMDeviceDriverOptions) {
        this.shellRunner = options?.shellRunner;
        this.llmLogger = options?.llmLogger;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        const t0 = performance.now();
        let t = t0;
        const _log = (label: string) => {
            const now = performance.now();
            console.log(`[Boot]     ↳ llm.${label}: +${(now - t).toFixed(0)}ms`);
            t = now;
        };

        // /etc is a rootfs built-in directory — no mount() needed.
        // getEngine('etc') returns a special ModuleFS with root at /etc/.
        this.engine = this.vfs.getEngine(STORAGE_MODULE);
        _log('getEngine');

        // Initialise helpers first (no async deps)
        this.vfsHelpers = new VFSHelpers(this.engine);
        this.migrationHelper = new MigrationHelper(this.engine, this.vfs, this.vfsHelpers);
        this.providerManager = new ProviderManager(this.engine, this.vfsHelpers, () => this.notify());
        this.connectionManager = new ConnectionManager(this.vfsHelpers, this.vfs, this.providerManager, () => this.notify());
        this.mcpManager = new MCPManager(this.vfsHelpers, this.vfs, () => this.notify());
        this.skillManager = new SkillManager(this.vfsHelpers, this.vfs, this.mcpManager, this.shellRunner, () => this.notify());

        // Migrate data from old paths if needed
        await this.migrationHelper.migrateConnectionsIfNeeded();
        _log('migrateConnections');
        await this.migrationHelper.migrateMCPIfNeeded();
        _log('migrateMCP');

        // Pre-load all data directories in parallel
        const [preProviders, preConnections, preMcps, preSkills] = await Promise.all([
            this.vfsHelpers.loadJsonFilesFromDir<LLMProvider>(PROVIDERS_DIR),
            this.vfsHelpers.loadJsonFilesFromDir<LLMConnection>(CONNECTIONS_DIR),
            this.vfsHelpers.loadJsonFilesFromDir<MCPServer>(MCP_DIR),
            this.vfsHelpers.loadJsonFilesFromDir<LLMSkill>(SKILLS_DIR),
        ]);
        _log('preloadDirs');

        // Load pricing config, then init cost store
        await this.providerManager.loadPricing();
        _log('loadPricing');
        const costStore = new CostStore(this.engine);
        await costStore.ensureFile();
        this.costManager = new CostManager(costStore);
        _log('initCostStore');

        // Sync default providers, then merge into cache
        await this.providerManager.syncDefaultProviders(preProviders);
        _log('syncDefaultProviders');
        this.providerManager.reloadProvidersFrom(preProviders);
        _log('reloadProviders');

        // Sync default connections, then cache
        const updatedConns = await this.connectionManager.ensureDefaultsWith(preConnections);
        _log('ensureDefaults');
        this.connectionManager.setConnections(updatedConns);
        _log('reload');

        // Cache MCP & skills from pre-loaded data
        this.mcpManager.setServers(preMcps);
        _log('reloadMCP');
        this.skillManager.setSkills(preSkills);
        _log('reloadSkills');

        // Cross-tab sync
        this.bindVFSEvents();
        console.log(`[Boot]     ↳ llm.init total: ${(performance.now() - t0).toFixed(0)}ms`);
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
        await this.mcpManager.disconnectAll();
        this.sessions.clear();
    }

    // ─── createDeviceNodes ────────────────────────────────────────────────────

    /**
     * 在 VFS 中建立 /dev/llm/ 目录树并创建设备文件。
     */
    async createDeviceNodes(): Promise<void> {
        // 建父目录（普通目录，不是 device 文件）
        await this.vfs.ensureSystemDirectory('/dev/llm');
        await this.vfs.ensureSystemDirectory('/dev/llm/connection');
        await this.vfs.ensureSystemDirectory('/dev/llm/mcp');
        await this.vfs.ensureSystemDirectory('/dev/llm/skills');

        // Connection device files
        for (const conn of this.connectionManager.getRawConnections()) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/connection/${conn.id}`, {
                resourceType: 'connection',
                resourceId: conn.id,
            });
        }

        // MCP device files + auto-connect
        for (const server of this.mcpManager.getRawServers()) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/mcp/${server.id}`, {
                resourceType: 'mcp',
                resourceId: server.id,
            });
            if (server.autoConnect) {
                // Race with a 3s timeout so a dead server doesn't block boot.
                try {
                    await Promise.race([
                        this.mcpManager.connectMCPServer(server),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
                    ]);
                } catch (e) {
                    console.error(`[LLMDeviceDriver] Auto-connect MCP server '${server.id}' failed:`, e);
                }
            }
        }

        // Skill device files
        for (const skill of this.skillManager.getRawSkills()) {
            await this.vfs.createDeviceNode('llm', `/dev/llm/skills/${skill.id}`, {
                resourceType: 'skill',
                resourceId: skill.id,
            });
        }
    }

    // ─── IDeviceDriver: open / close ─────────────────────────────────────────

    async open(ctx: DeviceContext, options?: Record<string, unknown>): Promise<string> {
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
        const msg = this.decodeMessage(content);
        session.history.push(msg);

        if (msg.role === 'user' || msg.role === 'system') {
            this.llmLogger?.logMessage(session.id, msg.role, this.extractContent(msg));
        }
        this.llmLogger?.logRequest(session.id, {
            provider: session.driver.providerName,
            model: session.driver.currentModel ?? '',
            messages: session.history,
            params: session.completionDefaults,
        });

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
        switch (command) {
            case LLM_IOCTL.LIST_CONNECTIONS:
                return this.connectionManager.listConnections();

            case LLM_IOCTL.GET_CONNECTION_META:
                return this.connectionManager.getConnection(arg as string) ?? null;

            case LLM_IOCTL.GET_DEFAULT_CONNECTION:
                return this.connectionManager.getDefaultConnection();

            case LLM_IOCTL.GET_FULL_CONNECTION:
                return this.connectionManager.getFullConnection(arg as string);

            case LLM_IOCTL.SAVE_CONNECTION:
                await this.saveConnection(arg as LLMConnection, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.DELETE_CONNECTION:
                await this.deleteConnection(arg as string, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.TEST_CONNECTION_PARAMS:
                return testLLMConnection(arg as Parameters<typeof testLLMConnection>[0]) as Promise<ConnectionTestResult>;

            case LLM_IOCTL.LIST_MCP_SERVERS:
                return this.mcpManager.getMCPServers();

            case LLM_IOCTL.SAVE_MCP_SERVER:
                await this.mcpManager.saveMCPServer(arg as MCPServer, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.DELETE_MCP_SERVER:
                await this.mcpManager.deleteMCPServer(arg as string, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.CONNECT_MCP_SERVER: {
                const server = this.mcpManager.getRawServers().find(s => s.id === (arg as string));
                if (server) await this.mcpManager.connectMCPServer(server);
                return;
            }

            case LLM_IOCTL.DISCONNECT_MCP_SERVER: {
                await this.mcpManager.disconnectServer(arg as string);
                return;
            }

            case LLM_IOCTL.LIST_PROVIDERS:
                return this.providerManager.getProviders();

            case LLM_IOCTL.GET_PROVIDER:
                return this.providerManager.getProvider(arg as string) ?? null;

            case LLM_IOCTL.GET_FULL_PROVIDER:
                return this.providerManager.getFullProvider(arg as string) ?? null;

            case LLM_IOCTL.SAVE_PROVIDER:
                await this.providerManager.saveProvider(arg as LLMProvider, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.DELETE_PROVIDER:
                await this.providerManager.deleteProvider(arg as string, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.LIST_SKILLS:
                return this.skillManager.getSkills();

            case LLM_IOCTL.SAVE_SKILL:
                await this.saveSkill(arg as LLMSkill, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.DELETE_SKILL:
                await this.deleteSkill(arg as string, this.getSystemFS(ctx));
                return;

            case LLM_IOCTL.QUERY_COSTS_BY_SESSION:
                return this.costManager.queryBySession(arg as string);

            case LLM_IOCTL.QUERY_COSTS_BY_PROVIDER: {
                const f = arg as { providerId: string; dateFrom?: string; dateTo?: string };
                return this.costManager.queryAll({ providerId: f.providerId, dateFrom: f.dateFrom, dateTo: f.dateTo });
            }

            case LLM_IOCTL.QUERY_COSTS_ALL:
                return this.costManager.queryAll(arg as { providerId?: string; dateFrom?: string; dateTo?: string } | undefined);
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
                    return this.skillManager.invokeSkill(session.skill, args);
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

                const lastUserMsg = params.messages.filter(m => m.role === 'user').pop();
                if (lastUserMsg) {
                    this.llmLogger?.logMessage(llmSession.id, 'user', this.extractContent(lastUserMsg));
                }
                const { signal: _sig, ...logParams } = params as ChatCompletionParams & { signal?: unknown };
                this.llmLogger?.logRequest(llmSession.id, {
                    provider: llmSession.driver.providerName,
                    model: llmSession.driver.currentModel ?? '',
                    messages: params.messages,
                    params: logParams as Record<string, unknown>,
                });

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

            case LLM_IOCTL.GET_MODELS: {
                const provider = this.providerManager.getProvider(llmSession.connection.providerId);
                return provider?.models ?? [];
            }

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
        return this.connectionManager.getConnections();
    }

    async getConnection(id: string): Promise<ConnectionMeta | undefined> {
        return this.connectionManager.getConnection(id);
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        return this.connectionManager.getDefaultConnection();
    }

    async getFullConnection(id: string): Promise<LLMConnection | null> {
        return this.connectionManager.getFullConnection(id);
    }

    async saveConnection(conn: LLMConnection, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.connectionManager.saveConnection(conn, systemFS);
    }

    async deleteConnection(id: string, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.connectionManager.deleteConnection(id, systemFS);
    }

    onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    listConnections(): ConnectionMeta[] {
        return this.connectionManager.listConnections();
    }

    findConnection(id: string): ConnectionMeta | undefined {
        return this.connectionManager.findConnection(id);
    }

    // ─── ILLMManagementService — MCP ─────────────────────────────────────────

    async getMCPServers(): Promise<MCPServer[]> {
        return this.mcpManager.getMCPServers();
    }

    async saveMCPServer(server: MCPServer, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.mcpManager.saveMCPServer(server, systemFS);
    }

    async deleteMCPServer(id: string, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.mcpManager.deleteMCPServer(id, systemFS);
    }

    // ─── ILLMManagementService — Skills ──────────────────────────────────────

    async getSkills(): Promise<LLMSkill[]> {
        return this.skillManager.getSkills();
    }

    async saveSkill(skill: LLMSkill, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.skillManager.saveSkill(skill, systemFS);
    }

    async deleteSkill(id: string, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.skillManager.deleteSkill(id, systemFS);
    }

    // ─── ILLMManagementService — Cost tracking ────────────────────────────────

    async recordCost(params: Parameters<import('@itookit/common').ILLMManagementService['recordCost']>[0]): Promise<void> {
        return this.costManager.recordCost(params);
    }

    async writePricing(config: import('@itookit/common').ModelPricingConfig): Promise<void> {
        return this.providerManager.writePricing(config);
    }

    async queryCosts(filter?: {
        dateFrom?: string;
        dateTo?: string;
        providerId?: string;
    }): Promise<import('@itookit/common').CostRecord[]> {
        return this.costManager.queryCosts(filter);
    }

    getPricingConfig(): import('@itookit/common').ModelPricingConfig {
        return this.providerManager.getPricingConfig();
    }

    getPricingDefaults(): import('@itookit/common').ModelPricingConfig {
        return this.providerManager.getPricingDefaults();
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
        return this.providerManager.getProviderDefaults();
    }

    getProvider(providerId: string): LLMProvider | undefined {
        return this.providerManager.getProvider(providerId);
    }

    getProviders(): LLMProvider[] {
        return this.providerManager.getProviders();
    }

    getFullProvider(id: string): LLMProvider | undefined {
        return this.providerManager.getFullProvider(id);
    }

    async saveProvider(provider: LLMProvider, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.providerManager.saveProvider(provider, systemFS);
    }

    async deleteProvider(id: string, systemFS?: IModuleFS): Promise<void> {
        this.cancelPendingSync();
        await this.providerManager.deleteProvider(id, systemFS);
    }

    async testConnection(params: { provider: string; apiKey: string; baseURL?: string; model?: string }): Promise<ConnectionTestResult> {
        return testLLMConnection(params);
    }

    // ─── Session management ───────────────────────────────────────────────────

    private async openConnectionSession(
        connectionId: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const opts = options as LLMDeviceOpenOptions | undefined;
        const conn = this.connectionManager.findRawConnection(connectionId)
            ?? this.connectionManager.findRawConnection('default')
            ?? this.connectionManager.getRawConnections()[0];

        if (!conn) {
            throw new Error(`LLMDeviceDriver: no connection available for id '${connectionId}'`);
        }
        if (conn.enabled === false) {
            throw new Error(`LLMDeviceDriver: connection '${conn.id}' is disabled`);
        }
        const pid = conn.providerId;
        const provider = this.providerManager.getFullProviderMap().get(pid);
        if (provider?.enabled === false) {
            throw new Error(`LLMDeviceDriver: provider '${conn.providerId}' is disabled`);
        }
        const apiKey = provider?.apiKey?.trim();
        if (!apiKey) {
            throw new Error(
                `LLMDeviceDriver: provider '${conn.providerId}' has no API key configured`
            );
        }

        const effectiveTiers = conn.tiers;
        const resolvedModel =
            effectiveTiers?.optimal
            ?? provider?.models[0]?.id
            ?? '';

        const resolvedModelDef = provider?.models.find(m => m.id === resolvedModel);
        const resolvedThinkingMode = resolvedModelDef?.thinkingMode;

        const effectiveProtocol =
            conn.protocol
            ?? (opts?.runMode === 'kernel' && provider?.anthropicPath ? 'anthropic-messages' as const : undefined)
            ?? (opts?.runMode !== 'kernel' && provider?.anthropicPath ? 'anthropic-messages' as const : undefined);
        const connForDriver = {
            ...conn,
            apiKey,
            model: resolvedModel,
            protocol: effectiveProtocol,
            ...(resolvedThinkingMode ? {
                metadata: { ...conn.metadata, thinkingMode: resolvedThinkingMode },
            } : {}),
        };

        const pkey = connForDriver.providerId;
        const customProviderDefaults = provider && pkey ? { [pkey]: provider } : undefined;

        const baseLabel = sanitizeLabel((opts?.sessionLabel as string) ?? '');
        const sessionId = baseLabel || `llm-${++this.sessionSeq}`;
        const driver = new LLMDriver({
            connection: connForDriver,
            customProviderDefaults,
            hooks: {
                onResponseHeaders: (headers, status) => {
                    this.llmLogger?.logResponse(sessionId, { status, headers });
                },
            },
        });
        const history: ChatMessage[] = opts?.systemPrompt
            ? [{ role: 'system', content: opts.systemPrompt }]
            : [];

        this.sessions.set(sessionId, {
            id: sessionId,
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
        const server = this.mcpManager.getRawServers().find(s => s.id === serverId);
        if (!server) {
            throw new Error(`LLMDeviceDriver: MCP server '${serverId}' not found`);
        }

        if (!this.mcpManager.getActiveConn(serverId)) {
            await this.mcpManager.connectMCPServer(server);
        }

        const conn = this.mcpManager.getActiveConn(serverId)!;
        const sessionId = `mcp-${++this.sessionSeq}`;
        this.sessions.set(sessionId, {
            kind: 'mcp',
            connection: conn,
            server,
        });
        return sessionId;
    }

    private openSkillSession(skillId: string): string {
        const skill = this.skillManager.findSkill(skillId);
        if (!skill) throw new Error(`LLMDeviceDriver: skill '${skillId}' not found`);
        const sessionId = `skill-${++this.sessionSeq}`;
        this.sessions.set(sessionId, { kind: 'skill', skill });
        return sessionId;
    }

    // ─── VFS event binding ────────────────────────────────────────────────────

    private cancelPendingSync(): void {
        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
    }

    private bindVFSEvents(): void {
        const debounce = () => {
            if (this._syncTimer) clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(async () => {
                await this.connectionManager.reload();
                await this.mcpManager.reload();
                await this.skillManager.reload();
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

    private extractContent(msg: ChatMessage): string {
        const c = msg.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            return c
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map(p => p.text)
                .join('');
        }
        return '';
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
                this.llmLogger?.logMessage(session.id, 'assistant', response);
            }
            if (usage) session.lastUsage = usage;
            session.abortController = null;
        }
    }

    /** 无状态包装：不写 history（CHAT ioctl 使用），但记录日志 */
    private async *wrapStreamOnly(gen: AsyncGenerator<ChatCompletionChunk>, session: LLMSessionState): AsyncGenerator<ChatCompletionChunk> {
        const parts: string[] = [];
        try {
            for await (const chunk of gen) {
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) parts.push(delta);
                if (chunk.usage) session.lastUsage = chunk.usage;
                yield chunk;
            }
        } finally {
            const response = parts.join('');
            if (response) {
                this.llmLogger?.logMessage(session.id, 'assistant', response);
            }
            session.abortController = null;
        }
    }
}
