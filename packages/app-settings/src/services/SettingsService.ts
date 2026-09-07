import { workspaceFiles, writeWorkspaceFile, type WorkspaceFileSource } from './workspace-files';
import { exportFileSystem, importFileSystem } from '@itookit/vfs-core';
/**
 * @file: app-settings/services/SettingsService.ts
 */
import type { IVFSManager, IFileSystem } from '@itookit/vfs-core';
import { FSNotFoundError } from '@itookit/vfs-core';
import type { SyncMode } from '../types/sync';
import { SettingsState, Contact, Tag } from '../types/types';
import { SnapshotService } from './SnapshotService';

// UI display: modules not shown to users in workspace picker


const FILES = {
    tags: '/tags.json',
    contacts: '/contacts.json',
    sync: '/sync_config.json',
};

// ============================================
// 类型定义
// ============================================

// [新增] 同步配置接口 (Fix Error 1)
export interface SyncConfig {
    serverUrl: string;
    username: string;
    token?: string;
    strategy: 'manual' | 'bidirectional' | 'push' | 'pull';
    autoSync: boolean;
}

// [新增] 同步状态接口 (Fix Error 2)
export interface SyncStatus {
    state: 'idle' | 'syncing' | 'error' | 'success';
    lastSyncTime: number | null;
    errorMessage?: string;
}

// Re-export so existing callers don't need to change imports
export type { LocalSnapshot } from './SnapshotService';

// Helper types for Sync Protocol
interface FileMeta {
    path: string;
    hash: string;
    mtime: number;
    is_deleted: boolean;
}

type ChangeListener = () => void;

// ============================================
// SettingsService
// ============================================

/**
 * SettingsService
 * 职责：
 * 1. 管理通用应用设置（Tags, Contacts）
 * 2. 提供系统级维护功能（快照、备份、重置）
 * 3. 协调 VFS 配置模块的挂载
 */
export class SettingsService {
    configFiles!: IFileSystem;
    public readonly vfs: IVFSManager;
    private dbName: string;

    private state: Pick<SettingsState, 'tags' | 'contacts'> = {
        tags: [],
        contacts: [],
    };

    private syncConfig: SyncConfig = {
        serverUrl: '',
        username: '',
        strategy: 'manual',
        autoSync: false
    };
    private syncStatus: SyncStatus = { state: 'idle', lastSyncTime: null };

    private listeners: Set<ChangeListener> = new Set();
    private initialized = false;
    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    private eventUnsubscribers: Array<() => void> = [];

    public readonly snapshot: SnapshotService;

    constructor(vfs: IVFSManager, dbName: string = 'MindOS-v2', readonly workspaces: readonly WorkspaceFileSource[] = []) {
        this.vfs = vfs;
        this.dbName = dbName;
        this.snapshot = new SnapshotService(vfs, dbName);
    }

    // =========================================================
    // 初始化
    // =========================================================

    async init(): Promise<void> {
        if (this.initialized) return;

        this.configFiles = await this.vfs.openFileSystem('/etc');

        // 1. 加载数据
        await Promise.all([
            this.loadEntity('contacts'),
            this.syncTags(),
            this.loadSyncConfig(),
        ]);

        // 2. 启动 VFS 事件监听
        this.bindVFSEvents();

        this.initialized = true;
        this.notify();
    }

    /**
     * 检查是否为"未找到"错误
     */
    private isNotFoundError(e: any): boolean {
        return (
            e instanceof FSNotFoundError ||
            e?.code === 'ENOENT' ||
            e?.code === 'NOT_FOUND' ||
            String(e?.message).toLowerCase().includes('not found')
        );
    }

    /**
     * 监听 VFS 事件以保持 Tag 计数同步
     */
    private bindVFSEvents(): void {
        const debounce = () => {
            if (this.syncTimer) clearTimeout(this.syncTimer);
            this.syncTimer = setTimeout(() => {
                this.syncTags().then(() => this.notify());

                if (this.syncConfig.autoSync &&
                    this.syncStatus.state !== 'syncing' &&
                    this.syncConfig.serverUrl) {
                    console.log('[AutoSync] Triggered');
                    this.triggerSync().catch(e => console.error('AutoSync failed', e));
                }
            }, 2000);
        };

        for (const source of this.workspaces) this.eventUnsubscribers.push(
            source.fs.on('node:created', debounce), source.fs.on('node:updated', debounce),
            source.fs.on('node:deleted', debounce), source.fs.on('node:renamed', debounce),
        );
    }

    // =========================================================
    // 通用实体存取 (Tags / Contacts)
    // =========================================================

    private async loadEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K): Promise<void> {
        const path = FILES[key];
        try {
            const content = await this.configFiles.driver.readContent(path);
            const jsonStr = typeof content === 'string' 
                ? content 
                : new TextDecoder().decode(content as ArrayBuffer);
            this.state[key] = JSON.parse(jsonStr);
        } catch (e: any) {
            if (this.isNotFoundError(e)) {
                this.state[key] = [];
            } else {
                console.error(`Failed to load ${key}`, e);
            }
        }
    }

    private async saveEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K): Promise<void> {
        const path = FILES[key];
        const content = JSON.stringify(this.state[key], null, 2);
        await writeWorkspaceFile(this.configFiles, path, content);
        if (key !== 'tags') this.notify();
    }

    // =========================================================
    // CRUD: Contacts
    // =========================================================

    getContacts(): Contact[] {
        return [...this.state.contacts];
    }

    async saveContact(contact: Contact): Promise<void> {
        this.updateOrAdd(this.state.contacts, contact);
        await this.saveEntity('contacts');
    }

    async deleteContact(id: string): Promise<void> {
        this.state.contacts = this.state.contacts.filter((c) => c.id !== id);
        await this.saveEntity('contacts');
        this.notify();
    }

    // =========================================================
    // CRUD: Tags
    // =========================================================

    getTags(): Tag[] {
        return [...this.state.tags];
    }

    public async syncTags(): Promise<void> {
        try {
            let configTags: Tag[] = [];
            try {
                const content = await this.configFiles.driver.readContent(FILES.tags);
                const jsonStr = typeof content === 'string' 
                    ? content 
                    : new TextDecoder().decode(content as ArrayBuffer);
                configTags = JSON.parse(jsonStr);
            } catch (e) {
                // ignore if file not exists
            }

            const counts = new Map<string, { name: string; color?: string; refCount: number }>();
            for (const source of this.workspaces) for (const tag of await source.fs.meta.tags.getAllTags()) {
                let count = 0;
                await source.fs.meta.tags.walkByTag(tag.name, () => { count++; return true; });
                const previous = counts.get(tag.name);
                counts.set(tag.name, { name: tag.name, color: tag.color ?? previous?.color,
                    refCount: (previous?.refCount ?? 0) + count });
            }
            const vfsTags = [...counts.values()];

            const mergedTags: Tag[] = vfsTags.map((vTag) => {
                const configTag = configTags.find((ct) => ct.name === vTag.name);
                return {
                    id: vTag.name,
                    name: vTag.name,
                    color: vTag.color || configTag?.color || '#3b82f6',
                    description: configTag?.description || '',
                    count: vTag.refCount || 0,
                };
            });

            const oldStateStr = JSON.stringify(this.state.tags);
            this.state.tags = mergedTags;
            const newStateStr = JSON.stringify(this.state.tags);

            if (oldStateStr !== newStateStr) {
                this.saveEntity('tags').catch((err) =>
                    console.error('Failed to save merged tags', err)
                );
                if (this.initialized) this.notify();
            }
        } catch (e) {
            console.error('[SettingsService] Failed to sync tags:', e);
        }
    }

    async saveTag(tag: Tag): Promise<void> {
        // 更新 VFS 的标签定义
        this.updateOrAdd(this.state.tags, tag);
        await this.saveEntity('tags');
    }

    async deleteTag(tagId: string): Promise<void> {
        const tag = this.state.tags.find((t) => t.id === tagId);
        if (!tag) return;

        // 注意：VFS 可能没有直接的 deleteTagDefinition
        // 需要通过 TagManager 或者从所有节点移除该标签
        try {
            for (const source of this.workspaces) {
                const paths: string[] = [];
                await source.fs.meta.tags.walkByTag(tag.name, path => { paths.push(path); return true; });
                for (const path of paths) await source.fs.meta.tags.removeTag(path, tag.name);
            }
        } catch (e) {
            console.warn('Failed to cleanup tag from nodes', e);
        }

        this.state.tags = this.state.tags.filter((t) => t.id !== tagId);
        await this.saveEntity('tags');
        this.notify();
    }

    // =========================================================
    // 同步功能
    // =========================================================

    async getSyncConfig(): Promise<SyncConfig> {
        return { ...this.syncConfig };
    }

    async getSyncStatus(): Promise<SyncStatus> {
        return { ...this.syncStatus };
    }

    async loadSyncConfig(): Promise<void> {
        try {
            const content = await this.configFiles.driver.readContent(FILES.sync);
            const jsonStr = typeof content === 'string' 
                ? content 
                : new TextDecoder().decode(content as ArrayBuffer);
            const loaded = JSON.parse(jsonStr);
            this.syncConfig = { ...this.syncConfig, ...loaded };
        } catch (e) {
            // ignore
        }
    }

    async saveSyncConfig(config: SyncConfig): Promise<void> {
        this.syncConfig = config;
        await writeWorkspaceFile(this.configFiles, FILES.sync, JSON.stringify(config, null, 2));
    }

    async testConnection(url: string, _user: string, token: string): Promise<boolean> {
        try {
            const res = await fetch(`${url}/api/sync/check`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify([])
            });
            return res.ok;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

  /**
   * 触发同步
   * @param mode 同步模式：
   *  - 'standard': 双向智能对比 (默认)
   *  - 'force_push': 强制用本地文件覆盖服务器 (Client -> Server)
   *  - 'force_pull': 强制用服务器文件覆盖本地 (Server -> Client)
   */
    async triggerSync(mode: SyncMode = 'standard'): Promise<void> {
        if (!this.syncConfig.serverUrl) throw new Error('No server URL');
        const token = this.syncConfig.token;
        if (!token) throw new Error('No Access Token configured');
    
    try {
        this.syncStatus = { state: 'syncing', lastSyncTime: this.syncStatus.lastSyncTime };
            this.notify();

            // 1. 索引本地文件
            const localFiles = await this.indexAllLocalFiles();

            let uploadList: string[] = [];
            let downloadList: FileMeta[] = [];

            if (mode === 'force_push') {
                console.log('[Sync] Force Push Mode: Uploading all local files...');
                uploadList = localFiles.map(f => f.path);
                downloadList = [];
            }
            else if (mode === 'force_pull') {
                console.log('[Sync] Force Pull Mode: Downloading all server files...');
                const checkRes = await this.checkDiff([], token);
                uploadList = [];
                downloadList = checkRes.files_to_download;
            }
            else {
                console.log('[Sync] Standard Mode: Checking diff...');
                const checkRes = await this.checkDiff(localFiles, token);

                if (this.syncConfig.strategy !== 'pull') {
                    uploadList = checkRes.files_to_upload;
                }
                if (this.syncConfig.strategy !== 'push') {
                    downloadList = checkRes.files_to_download;
                }
            }

            console.log(`[Sync] Plan: Upload ${uploadList.length}, Download ${downloadList.length}`);

            // 2. 执行上传
            for (const path of uploadList) {
                await this.uploadFile(path, token);
            }

            // 3. 执行下载
            for (const meta of downloadList) {
                await this.downloadFile(meta, token);
            }

            this.syncStatus = { state: 'success', lastSyncTime: Date.now() };
        } catch (e: any) {
            console.error('Sync Error', e);
            this.syncStatus = { 
                state: 'error', 
                lastSyncTime: this.syncStatus.lastSyncTime, 
                errorMessage: e.message 
            };
            throw e;
        } finally {
            this.notify();
        }
    }

    private async checkDiff(clientFiles: FileMeta[], token: string): Promise<{
        files_to_upload: string[];
        files_to_download: FileMeta[];
    }> {
        const checkRes = await fetch(`${this.syncConfig.serverUrl}/api/sync/check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(clientFiles)
        });

        if (!checkRes.ok) throw new Error('Sync check failed (Invalid Token or Server Error)');
        return await checkRes.json();
    }

    private async indexAllLocalFiles(): Promise<FileMeta[]> {
        const files: FileMeta[] = [];
        const modules = this.workspaces.filter(source => source.syncEnabled);

        for (const mod of modules) {
            try {
                await this.traverseModuleFiles(mod.name, files);
            } catch (e) {
                console.warn(`[SettingsService] Failed to index module ${mod.name}`, e);
            }
        }
        return files;
    }

    private async traverseModuleFiles(moduleName: string, list: FileMeta[]): Promise<void> {
        const engine = workspaceFiles(this.workspaces, moduleName);

        await engine.driver.walkTree?.(async (node) => {
            if (node.type !== 'file') return;
            try {
                const raw = await engine.driver.readContent(node.path);
                const buffer = this.toArrayBuffer(raw);
                const hash = await this.computeSHA256(buffer);
                list.push({
                    path: `/${moduleName}${node.path}`,
                    hash,
                    mtime: node.modifiedAt,
                    is_deleted: false,
                });
            } catch { /* skip */ }
        }, { includeHidden: true, includeAssetDirs: true, includeInternalDirs: true });
    }

    private async uploadFile(systemPath: string, token: string): Promise<void> {
        try {
            const parts = systemPath.split('/').filter(Boolean);
            const moduleName = parts[0];
            const innerPath = '/' + parts.slice(1).join('/');

            const content = await workspaceFiles(this.workspaces, moduleName).driver.readContent(innerPath);
            const blob = new Blob([this.toArrayBuffer(content)]);

            const formData = new FormData();
            formData.append(systemPath, blob);

            await fetch(`${this.syncConfig.serverUrl}/api/sync/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
        } catch (e) {
            console.warn(`Failed to upload ${systemPath}`, e);
        }
    }

    private async downloadFile(meta: FileMeta, token: string): Promise<void> {
        try {
            const res = await fetch(`${this.syncConfig.serverUrl}/api/sync/download`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ path: meta.path })
            });

            if (!res.ok) throw new Error('Download failed');
            const arrayBuffer = await res.arrayBuffer();

            const parts = meta.path.split('/').filter(Boolean);
            const moduleName = parts[0];
            const innerParts = parts.slice(1);

            if (!this.workspaces.some(source => source.name === moduleName && source.syncEnabled)) throw new Error('Sync source unavailable');

            // Asset file: second-to-last segment is an assetdir (starts with '_')
            if (innerParts.length >= 2 && innerParts[innerParts.length - 2].startsWith('_')) {
                const assetName = innerParts[innerParts.length - 1];
                const ownerName = innerParts[innerParts.length - 2].slice(1); // strip '_'
                const ownerPath = '/' + [...innerParts.slice(0, -2), ownerName].join('/');
                const engine = workspaceFiles(this.workspaces, moduleName);
                await engine.meta.assets?.putAsset(ownerPath, assetName, arrayBuffer);
            } else {
                const userPath = '/' + innerParts.join('/');
                await writeWorkspaceFile(workspaceFiles(this.workspaces, moduleName), userPath, arrayBuffer);
            }
        } catch (e) {
            console.error(`Failed to download ${meta.path}`, e);
        }
    }

    // Note: same logic as toBuffer() in @itookit/vfs-core — duplicated here due to package boundary
    private toArrayBuffer(data: string | ArrayBuffer | Uint8Array): ArrayBuffer {
        if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer;
        if (data instanceof Uint8Array) {
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        }
        return data;
    }

    private async computeSHA256(buffer: ArrayBuffer): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // =========================================================
    // Export/Import Logic
    // =========================================================

    async exportMixedData(
        settingsKeys: (keyof SettingsState)[], 
        moduleNames: string[]
    ): Promise<any> {
        const exportData: any = {
            version: 3,
            timestamp: Date.now(),
            type: 'mixed_backup',
            settings: {},
            workspaces: [],
        };

        if (settingsKeys.includes('tags')) {
            exportData.settings.tags = this.state.tags;
        }
        if (settingsKeys.includes('contacts')) {
            exportData.settings.contacts = this.state.contacts;
        }

        for (const name of moduleNames) {
            exportData.workspaces.push({ name, archive: await exportFileSystem(workspaceFiles(this.workspaces, name)) });
        }
        return exportData;
    }

    async importMixedData(
        data: any,
        settingsKeys: (keyof SettingsState)[],
        workspaceNames: string[],
        _options: { overwrite?: boolean; mergeTags?: boolean } = {}
    ): Promise<void> {
        if (data?.version !== 3 || data.type !== 'mixed_backup' || !Array.isArray(data.workspaces)) throw new Error('Unsupported backup; convert it before importing');
        const selected = data.workspaces.filter((entry: any) => workspaceNames.includes(entry.name));
        const seen = new Set<string>();
        for (const entry of selected) {
            if (seen.has(entry.name)) throw new Error(`Duplicate backup workspace: ${entry.name}`);
            seen.add(entry.name);
            workspaceFiles(this.workspaces, entry.name);
        }
        for (const name of workspaceNames) if (!seen.has(name)) throw new Error(`Backup workspace missing: ${name}`);
        // Cross-source restore is not atomic. Propagate failures so the UI never
        // reports success for a partial restore. Settings are saved afterwards.
        for (const entry of selected) await importFileSystem(workspaceFiles(this.workspaces, entry.name), entry.archive);
        if (settingsKeys.includes('tags') && Array.isArray(data.settings?.tags)) {
            this.state.tags = data.settings.tags;
            await this.saveEntity('tags');
        }
        if (settingsKeys.includes('contacts') && Array.isArray(data.settings?.contacts)) {
            this.state.contacts = data.settings.contacts;
            await this.saveEntity('contacts');
        }
        await this.syncTags();
        this.notify();
    }

    // =========================================================
    // 本地快照管理 — 委托给 SnapshotService
    // =========================================================

    listLocalSnapshots() { return this.snapshot.listLocalSnapshots(); }
    createSnapshot()     { return this.snapshot.createSnapshot(); }
    deleteSnapshot(name: string) { return this.snapshot.deleteSnapshot(name); }

    async restoreSnapshot(snapshotName: string): Promise<void> {
        await this.snapshot.restoreSnapshot(snapshotName);
        // 恢复后需要重新初始化 VFS
    }

    // =========================================================
    // 系统级操作
    // =========================================================

    async factoryReset(): Promise<void> {
        // 关闭 VFS
        await this.vfs.dispose();
        
        // 删除主数据库
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.deleteDatabase(this.dbName);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => {
                console.warn('Factory reset blocked, forcing...');
                resolve();
            };
        });

        // 重置状态
        this.state = { tags: [], contacts: [] };
        this.syncConfig = {
            serverUrl: '',
            username: '',
            strategy: 'manual',
            autoSync: false
        };
        this.syncStatus = { state: 'idle', lastSyncTime: null };
        this.initialized = false;
    }

    // =========================================================
    // 辅助方法 & 事件
    // =========================================================

    private updateOrAdd<T extends { id: string }>(list: T[], item: T): void {
        const idx = list.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
            list[idx] = item;
        } else {
            list.push(item);
        }
        this.notify();
    }

    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        this.listeners.forEach((l) => {
            try {
                l();
            } catch (e) {
                console.error('[SettingsService] Listener error:', e);
            }
        });
    }

    getAvailableSettingsKeys(): (keyof SettingsState)[] {
        return ['tags', 'contacts'];
    }

    getAvailableWorkspaces(): Array<{ name: string; description?: string }> {
        return this.workspaces.map(source => ({ name: source.name, description: source.description }));
    }

    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        // 取消事件订阅
        this.eventUnsubscribers.forEach(fn => fn());
        this.eventUnsubscribers = [];

        // 清理定时器
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }

        // 清理监听器
        this.listeners.clear();

        this.initialized = false;
    }
}

