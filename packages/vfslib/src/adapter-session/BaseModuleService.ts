/**
 * @file packages/vfslib/src/adapter-session/BaseModuleService.ts
 * @desc 基础模块服务 — 提供模块初始化、JSON 读写、目录创建、变更通知。
 *
 * v3.3: engine 字段从 VFSModuleEngine 迁移为 IModuleFS。
 *       VFSModuleEngine 已废弃，BaseModuleService 不再依赖它。
 */

import type { IVFSManager, IModuleFS } from '@itookit/common';

// ── 公共类型 ──────────────────────────────────────────────────

export type ChangeListener = () => void;

export interface ModuleServiceOptions {
    description?: string;
    isProtected?: boolean;
    /** System modules bypass all VFS access control checks (hidden files, cross-module access) */
    isSystem?: boolean;
}

// ── BaseModuleService ──────────────────────────────────────────

/**
 * 基础模块服务
 *
 * 提供模块初始化、JSON 读写、目录创建、变更通知等通用功能。
 * 依赖 IVFSManager（抽象接口），engine 字段为 IModuleFS (v3.3)。
 */
export abstract class BaseModuleService {
    /** v3.3: IModuleFS — 子类通过 engine.driver.* 进行文件操作 */
    public readonly engine: IModuleFS;
    protected initialized = false;
    protected listeners = new Set<ChangeListener>();

    constructor(
        protected readonly moduleName: string,
        protected readonly options: ModuleServiceOptions = {},
        public readonly vfs: IVFSManager,
    ) {
        this.engine = this.vfs.getEngine(moduleName);
    }

    // ── 生命周期 ──────────────────────────────────────────────

    async init(): Promise<void> {
        if (this.initialized) return;
        await this.vfs.mount(this.moduleName, this.options);
        await this.engine.init();
        await this.onLoad();
        this.initialized = true;
        this.notify();
    }

    protected abstract onLoad(): Promise<void>;

    get isInitialized(): boolean {
        return this.initialized;
    }

    async dispose(): Promise<void> {
        this.listeners.clear();
        this.initialized = false;
    }

    // ── JSON 辅助方法 ─────────────────────────────────────────

    /**
     * 读取 JSON 文件
     * @returns 解析后的对象，文件不存在返回 null
     */
    protected async readJson<T>(path: string): Promise<T | null> {
        try {
            const content = await this.vfs.read(this.moduleName, path);
            const str =
                typeof content === 'string'
                    ? content
                    : new TextDecoder().decode(content as ArrayBuffer);
            return JSON.parse(str) as T;
        } catch (e: any) {
            const isNotFound =
                e.message?.toLowerCase().includes('not found') ||
                e.code === 'ENOENT' ||
                e.code === 'NOT_FOUND';
            if (!isNotFound) {
                console.warn(`[${this.constructor.name}] Failed to read ${path}:`, e);
            }
            return null;
        }
    }

    /**
     * 写入 JSON 文件（upsert 语义：不存在则创建，含中间目录）
     */
    protected async writeJson(path: string, data: unknown): Promise<void> {
        await this.vfs.write(this.moduleName, path, JSON.stringify(data, null, 2));
    }

    // ── 目录/文件辅助 ─────────────────────────────────────────

    /**
     * 确保目录存在（递归创建）
     */
    async ensureDirectory(path: string): Promise<void> {
        const fs = this.engine;
        const normalized = path.startsWith('/') ? path : '/' + path;
        const parts = normalized.split('/').filter(Boolean);

        let current: string | null = null;
        for (const part of parts) {
            const next: string = current ? `${current}/${part}` : `/${part}`;
            try {
                await fs.driver.createDirectory({ name: part, parentPath: current });
            } catch (e: any) {
                if (!isAlreadyExistsLike(e)) throw e;
            }
            current = next;
        }
    }

    /**
     * 删除文件（路径不存在时静默跳过）
     */
    protected async deleteFile(path: string): Promise<void> {
        const nodeId = await this.engine.driver.resolvePath(path);
        if (nodeId) {
            await this.engine.driver.delete([nodeId]);
        }
    }

    /**
     * 检查文件是否存在
     */
    protected async fileExists(path: string): Promise<boolean> {
        return this.engine.driver.exists(path);
    }

    // ── 变更通知 ──────────────────────────────────────────────

    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    protected notify(): void {
        this.listeners.forEach(l => {
            try {
                l();
            } catch (e) {
                console.error('[BaseModuleService] Change listener error:', e);
            }
        });
    }
}

// ── 内部辅助 ─────────────────────────────────────────────────

function isAlreadyExistsLike(e: any): boolean {
    return (
        e?.code === 'EEXIST' ||
        e?.code === 'ALREADY_EXISTS' ||
        String(e?.message).toLowerCase().includes('exist')
    );
}
