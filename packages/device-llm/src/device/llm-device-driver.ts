// @file: device-llm/device/llm-device-driver.ts
//
// LLMDeviceDriver — 连接配置的唯一守护者 + LLM 通信设备。
//
// 职责：
//  1. 管理 LLMConnection 存储（VFS __llm 模块，仅该类可访问完整连接含 apiKey）
//  2. 对外暴露 ConnectionMeta（无 apiKey）供 AgentExecutor、AgentResolver 等使用
//  3. 通过 ioctl 为 Settings UI 提供连接 CRUD（含 GET_FULL_CONNECTION 供编辑）
//  4. 维护 Chat Session 生命周期（write / readStream / ioctl CHAT）

import type {
    IDeviceDriver, IConnectionService, DeviceContext, IVFSManager, FileContent,
    LLMConnection, ConnectionMeta, ChatMessage, ChatCompletionChunk,
    ChatCompletionParams, ChatCompletionResponse, TokenUsage,
    CreateFileOptions,
} from '@itookit/common';
import { toConnectionMeta, CONFIG_MODULE } from '@itookit/common';

import { LLMDriver } from '../core/driver';
import { testLLMConnection } from '../core/api';
import type { ConnectionTestResult } from '../core/api';
import { LLM_PROVIDER_DEFAULTS, CONST_CONFIG_VERSION } from '../constants';

// ─── 存储路径 ────────────────────────────────────────────────────────────────
// 存储在 __config 模块（isSystem: true），路径结构：
//   _llm/              → 下划线前缀，FS Explorer 可见
//   _llm/.connections/ → 点前缀，受 AccessController 保护（需 isSystem）
//   _llm/.connections/{id}.json
const STORAGE_MODULE    = CONFIG_MODULE;           // '__config'
const CONNECTIONS_DIR   = '/_llm/.connections';    // 点前缀目录，系统保护
const DEFAULTS_VERSION  = '/_llm/.connections_version.json';

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

    // ── Chat 会话（需要 sessionId）───────────────────────────────────────────
    /**
     * 无状态流式调用，不修改 session history。
     * arg: ChatCompletionParams（含 messages + signal）
     * 返回: AsyncGenerator<ChatCompletionChunk>
     */
    CHAT:             'chat',
    /** 无状态非流式调用，arg: ChatCompletionParams，返回: ChatCompletionResponse */
    CHAT_SYNC:        'chat-sync',
    /** → ChatMessage[]（当前会话历史） */
    GET_HISTORY:      'get-history',
    /** 清空历史（保留 system prompt），中止进行中的流 */
    CLEAR_HISTORY:    'clear-history',
    /** → LLMModel[] */
    GET_MODELS:       'get-models',
    /** 中止当前流式请求 */
    ABORT:            'abort',
    /** arg: string | undefined — 替换 system prompt */
    SET_SYSTEM_PROMPT:'set-system-prompt',
} as const;

export type LLMIoctlCommand = typeof LLM_IOCTL[keyof typeof LLM_IOCTL];

// ─── 公共类型 ─────────────────────────────────────────────────────────────────

/** open() options */
export interface LLMDeviceOpenOptions {
    /** 引用的连接 ID，由 driver 内部解析为完整 LLMConnection */
    connectionId: string;
    systemPrompt?: string;
    completionDefaults?: Record<string, unknown>;
}


// ─── 内部会话状态 ─────────────────────────────────────────────────────────────

interface SessionState {
    readonly driver: LLMDriver;
    readonly connection: LLMConnection;
    readonly completionDefaults: Record<string, unknown>;
    history: ChatMessage[];
    pendingStream: AsyncGenerator<ChatCompletionChunk> | null;
    lastResponse: string | null;
    lastUsage: TokenUsage | null;
    abortController: AbortController | null;
}

// ─── LLMDeviceDriver ─────────────────────────────────────────────────────────

/**
 * LLM 虚拟设备驱动。
 *
 * 是连接数据（apiKey 等）的唯一运行时持有者。
 * 所有外部访问连接信息均通过 ioctl 且返回安全的 ConnectionMeta。
 *
 * main.ts 初始化：
 *   const driver = new LLMDeviceDriver(vfsCore);
 *   await driver.init();
 *   vfsCore.devices.register(driver);
 *   setKernelDeviceManager(vfsCore.devices);
 */
export class LLMDeviceDriver implements IDeviceDriver, IConnectionService {
    readonly handlerId = 'llm';
    readonly description = 'LLM streaming chat & connection management device';
    readonly writable = true;
    readonly streamable = true;
    readonly sessionable = true;

    // ── Connection store ──
    private _connections: LLMConnection[] = [];
    private _listeners = new Set<() => void>();
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubs: Array<() => void> = [];

    // ── Chat sessions ──
    private readonly sessions = new Map<string, SessionState>();
    private sessionSeq = 0;

    /** engine: 由 init() 后通过 vfs.getEngine() 设置，使用前必须先调用 init() */
    private engine!: ReturnType<IVFSManager['getEngine']>;

    constructor(private readonly vfs: IVFSManager) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        // 1. 确保 __config 模块已挂载（SettingsService 之前或之后调用均可）
        if (!this.vfs.getModule(STORAGE_MODULE)) {
            await this.vfs.mount(STORAGE_MODULE, {
                description: 'Settings Persistence',
                isSystem: true,
            });
        }
        // 使用 isSystem: true 的 __config engine，可写 .connections 点前缀目录
        this.engine = this.vfs.getEngine(STORAGE_MODULE);

        // 2. 写入默认连接（增量）
        await this.ensureDefaults();

        // 3. 加载连接缓存
        await this.reload();

        // 4. 跨标签页同步（监听 __config 模块事件）
        this.bindVFSEvents();
    }

    async dispose(): Promise<void> {
        this._eventUnsubs.forEach(fn => fn());
        this._eventUnsubs = [];
        if (this._syncTimer) { clearTimeout(this._syncTimer); this._syncTimer = null; }
        this._listeners.clear();
        for (const s of this.sessions.values()) s.abortController?.abort();
        this.sessions.clear();
    }

    // ─── IDeviceDriver: open / close ─────────────────────────────────────────

    async open(ctx: DeviceContext, options?: Record<string, unknown>): Promise<string> {
        const opts = options as LLMDeviceOpenOptions | undefined;
        const connectionId = opts?.connectionId ?? 'default';

        const conn = this.findConn(connectionId)
            ?? this.findConn('default')
            ?? this._connections[0];

        if (!conn) {
            throw new Error(`LLMDeviceDriver: no connection available for id '${connectionId}'`);
        }
        if (!conn.apiKey?.trim()) {
            throw new Error(`LLMDeviceDriver: connection '${conn.id}' has no API key configured`);
        }

        const driver = new LLMDriver({ connection: conn });
        const history: ChatMessage[] = opts?.systemPrompt
            ? [{ role: 'system', content: opts.systemPrompt }]
            : [];

        const sessionId = `llm-${ctx.nodeId}-${++this.sessionSeq}`;
        this.sessions.set(sessionId, {
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

    async close(ctx: DeviceContext): Promise<void> {
        const session = this.requireSession(ctx);
        session.abortController?.abort();
        this.sessions.delete(ctx.sessionId!);
    }

    // ─── IDeviceDriver: I/O ──────────────────────────────────────────────────

    async write(ctx: DeviceContext, content: FileContent): Promise<void> {
        const session = this.requireSession(ctx);
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
        const session = this.requireSession(ctx);
        if (!session.pendingStream) return;
        const gen = session.pendingStream;
        session.pendingStream = null;
        for await (const chunk of gen) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) yield delta;
        }
    }

    async read(ctx: DeviceContext): Promise<FileContent> {
        const session = this.requireSession(ctx);
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
                return this._connections.map(toConnectionMeta);

            case LLM_IOCTL.GET_CONNECTION_META: {
                const c = this.findConn(arg as string);
                return c ? toConnectionMeta(c) : null;
            }

            case LLM_IOCTL.GET_DEFAULT_CONNECTION: {
                const c = this.defaultConnection;
                return c ? toConnectionMeta(c) : null;
            }

            case LLM_IOCTL.GET_FULL_CONNECTION:
                return this.findConn(arg as string) ?? null;

            case LLM_IOCTL.SAVE_CONNECTION: {
                const conn = arg as LLMConnection;
                await this.writeToDisk(conn);
                await this.reload();
                this.notify();
                return;
            }

            case LLM_IOCTL.DELETE_CONNECTION: {
                if (arg === 'default') throw new Error('Cannot delete the default connection');
                await this.deleteFromDisk(arg as string);
                await this.reload();
                this.notify();
                return;
            }

            case LLM_IOCTL.TEST_CONNECTION_PARAMS:
                return testLLMConnection(arg as Parameters<typeof testLLMConnection>[0]) as Promise<ConnectionTestResult>;
        }

        // ── Chat 会话命令（需要 sessionId）─────────────────────────────────────
        const session = this.requireSession(ctx);

        switch (command) {
            case LLM_IOCTL.CHAT: {
                const params = arg as ChatCompletionParams;
                session.abortController?.abort();
                session.pendingStream = null;
                const abort = new AbortController();
                params.signal?.addEventListener('abort', () => abort.abort(), { once: true });
                session.abortController = abort;
                const rawStream = await session.driver.chat.create({
                    ...params, stream: true, signal: abort.signal,
                });
                return this.wrapStreamOnly(rawStream, session);
            }

            case LLM_IOCTL.CHAT_SYNC: {
                const params = arg as ChatCompletionParams;
                return session.driver.chat.create({ ...params, stream: false }) as Promise<ChatCompletionResponse>;
            }

            case LLM_IOCTL.GET_HISTORY:
                return session.history.slice();

            case LLM_IOCTL.CLEAR_HISTORY:
                session.abortController?.abort();
                session.pendingStream = null;
                session.lastResponse = null;
                session.lastUsage = null;
                session.history = session.history.filter(m => m.role === 'system');
                return;

            case LLM_IOCTL.GET_MODELS:
                return session.connection.availableModels ?? [];

            case LLM_IOCTL.ABORT:
                session.abortController?.abort();
                session.pendingStream = null;
                return;

            case LLM_IOCTL.SET_SYSTEM_PROMPT: {
                const prompt = arg as string | undefined;
                session.history = session.history.filter(m => m.role !== 'system');
                if (prompt) session.history.unshift({ role: 'system', content: prompt });
                return;
            }

            default:
                throw new Error(`LLMDeviceDriver: unknown ioctl '${String(command)}'`);
        }
    }

    // ─── IConnectionService (direct API, no ioctl overhead) ──────────────────
    //
    // 调用方（VFSAgentService、ConnectionSettingsEditor 等）直接注入 LLMDeviceDriver
    // 作为 IConnectionService 使用，无需经过 ioctl 字符串路由。

    async getConnections(): Promise<ConnectionMeta[]> {
        return this._connections.map(toConnectionMeta);
    }

    async getConnection(id: string): Promise<ConnectionMeta | undefined> {
        const c = this.findConn(id);
        return c ? toConnectionMeta(c) : undefined;
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        const c = this.defaultConnection;
        return c ? toConnectionMeta(c) : null;
    }

    /** 返回完整连接（含 apiKey），仅供 Settings UI 编辑表单使用 */
    async getFullConnection(id: string): Promise<LLMConnection | null> {
        return this.findConn(id) ?? null;
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        await this.writeToDisk(conn);
        await this.reload();
        this.notify();
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === 'default') throw new Error('Cannot delete the default connection');
        await this.deleteFromDisk(id);
        await this.reload();
        this.notify();
    }

    onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
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
        const byProvider = new Map(current.map(c => [c.provider, c]));
        const keys = Object.keys(LLM_PROVIDER_DEFAULTS);
        const defaultKey = keys[0];

        for (const [key, def] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const existing = byProvider.get(key);
            if (!existing) {
                await this.writeToDisk({
                    id: key === defaultKey ? 'default' : `conn-${key}`,
                    name: def.name,
                    provider: key,
                    apiKey: '',
                    model: def.models[0]?.id ?? '',
                    baseURL: def.baseURL,
                    availableModels: [...def.models],
                    metadata: { isSystemDefault: true },
                });
            } else {
                // 仅追加新模型，不覆盖用户数据
                const updated: LLMConnection = JSON.parse(JSON.stringify(existing));
                if (!updated.availableModels) updated.availableModels = [];
                const known = new Set(updated.availableModels.map(m => m.id));
                let dirty = false;
                for (const m of def.models) {
                    if (!known.has(m.id)) { updated.availableModels.push({ ...m }); dirty = true; }
                }
                if (dirty) await this.writeToDisk(updated);
            }
        }
    }

    private async reload(): Promise<void> {
        this._connections = await this.loadAll();
    }

    private async loadAll(): Promise<LLMConnection[]> {
        const items: LLMConnection[] = [];
        try {
            const dirId = await this.engine.resolvePath(CONNECTIONS_DIR);
            if (!dirId) return [];
            const children = await this.engine.getChildren(dirId);
            for (const child of children) {
                if (child.type !== 'file' || !child.name.endsWith('.json')) continue;
                try {
                    const raw = await this.engine.readContent(child.id);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    items.push(JSON.parse(text) as LLMConnection);
                } catch { /* skip malformed */ }
            }
        } catch { /* directory not yet created */ }
        return items;
    }

    /**
     * 通过 engine（isSystem: true 的 __config）直接写入连接文件。
     * 不经过 vfs.write()，确保 AccessController 使用系统级 caller 上下文，
     * 可写入 .connections/ 点前缀目录。
     */
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

    /** engine-level upsert：resolvePath 存在则 writeContent，否则 createFile(recursive) */
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

    private bindVFSEvents(): void {
        const debounce = () => {
            if (this._syncTimer) clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(async () => {
                await this.reload();
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

    private requireSession(ctx: DeviceContext): SessionState {
        const s = this.sessions.get(ctx.sessionId!);
        if (!s) throw new Error(`LLMDeviceDriver: session '${ctx.sessionId}' not found`);
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

    /** 有状态包装：耗尽时将 assistant 响应写入 history */
    private async *wrapAccumulate(session: SessionState, gen: AsyncGenerator<ChatCompletionChunk>): AsyncGenerator<ChatCompletionChunk> {
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
    private async *wrapStreamOnly(gen: AsyncGenerator<ChatCompletionChunk>, session: SessionState): AsyncGenerator<ChatCompletionChunk> {
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
