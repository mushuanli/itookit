/**
 * @file: app-settings/services/SettingsService.ts
 */
import { FS_MODULE_AGENTS, CONFIG_MODULE } from '@itookit/common';
import type { IVFSManager, VFSManagerEvent } from '@itookit/common';
import { FSAlreadyExistsError, FSNotFoundError } from '@itookit/common';
import type { SyncMode } from '../types/sync';
import { SettingsState, Contact, Tag } from '../types/types';
import { SnapshotService } from './SnapshotService';

// UI display: modules not shown to users in workspace picker
const SYSTEM_MODULES = ['etc', '__vfs_meta__', 'settings_ui', FS_MODULE_AGENTS];


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

    constructor(vfs: IVFSManager, dbName: string = 'MindOS-v2') {
        this.vfs = vfs;
        this.dbName = dbName;
        this.snapshot = new SnapshotService(vfs, dbName);
    }

    // =========================================================
    // 初始化
    // =========================================================

    async init(): Promise<void> {
        if (this.initialized) return;

        // 1. 挂载配置存储模块
        if (!this.vfs.getModule(CONFIG_MODULE)) {
            try {
                await this.vfs.mount(CONFIG_MODULE, {
                    description: 'Settings Persistence',
                    isSystem: true,
                });
            } catch (e: any) {
                if (!this.isAlreadyExistsError(e)) throw e;
            }
        }

        // 2. 加载数据
        await Promise.all([
            this.loadEntity('contacts'),
            this.syncTags(),
            this.loadSyncConfig(),
        ]);

        // 3. 启动 VFS 事件监听
        this.bindVFSEvents();

        this.initialized = true;
        this.notify();
    }

    /**
     * 检查是否为"已存在"错误
     */
    private isAlreadyExistsError(e: any): boolean {
        return (
            e instanceof FSAlreadyExistsError ||
            e?.code === 'EEXIST' ||
            e?.code === 'ALREADY_EXISTS' ||
            String(e?.message).toLowerCase().includes('exist')
        );
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

        const isConfigEvent = (moduleId: string) => moduleId === CONFIG_MODULE;

        this.eventUnsubscribers.push(
            this.vfs.on('node:created', (e: VFSManagerEvent<'node:created'>) => {
                if (!isConfigEvent(e.payload.moduleId)) debounce();
            }),
            this.vfs.on('node:updated', (e: VFSManagerEvent<'node:updated'>) => {
                if (!isConfigEvent(e.payload.moduleId)) debounce();
            }),
            this.vfs.on('node:deleted', (e: VFSManagerEvent<'node:deleted'>) => {
                if (!isConfigEvent(e.payload.moduleId)) debounce();
            }),
        );
    }

    // =========================================================
    // 通用实体存取 (Tags / Contacts)
    // =========================================================

    private async loadEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K): Promise<void> {
        const path = FILES[key];
        try {
            const content = await this.vfs.read(CONFIG_MODULE, path);
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
        await this.vfs.write(CONFIG_MODULE, path, content);
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
                const content = await this.vfs.read(CONFIG_MODULE, FILES.tags);
                const jsonStr = typeof content === 'string' 
                    ? content 
                    : new TextDecoder().decode(content as ArrayBuffer);
                configTags = JSON.parse(jsonStr);
            } catch (e) {
                // ignore if file not exists
            }

            const vfsTags = await this.vfs.getAllTags();

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
        await this.vfs.updateTagDefinition(tag.name, { color: tag.color });
        this.updateOrAdd(this.state.tags, tag);
        await this.saveEntity('tags');
    }

    async deleteTag(tagId: string): Promise<void> {
        const tag = this.state.tags.find((t) => t.id === tagId);
        if (!tag) return;

        // 注意：VFS 可能没有直接的 deleteTagDefinition
        // 需要通过 TagManager 或者从所有节点移除该标签
        try {
            const tagNodes = await this.vfs.findByTag(tag.name);
            await Promise.all(tagNodes.map(async nodeId => {
                const nodeWithModule = await this.vfs.getNodeById(nodeId);
                if (nodeWithModule) {
                    const engine = this.vfs.getEngine(nodeWithModule.moduleName);
                    await engine.tags?.removeTag(nodeId, tag.name);
                }
            }));
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
            const content = await this.vfs.read(CONFIG_MODULE, FILES.sync);
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
        await this.vfs.write(CONFIG_MODULE, FILES.sync, JSON.stringify(config, null, 2));
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
        const modules = this.vfs.getAllModules().filter(m => !m.isSystem);

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
        const engine = this.vfs.getEngine(moduleName);

        await engine.walkTree?.(async (node) => {
            if (node.type !== 'file') return;
            try {
                const raw = await engine.readContent(node.id);
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

            const content = await this.vfs.read(moduleName, innerPath);
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

            if (!this.vfs.getModule(moduleName)) return;

            // Asset file: second-to-last segment is an assetdir (starts with '_')
            if (innerParts.length >= 2 && innerParts[innerParts.length - 2].startsWith('_')) {
                const assetName = innerParts[innerParts.length - 1];
                const ownerName = innerParts[innerParts.length - 2].slice(1); // strip '_'
                const ownerPath = '/' + [...innerParts.slice(0, -2), ownerName].join('/');
                const engine = this.vfs.getEngine(moduleName);
                await engine.assets?.putAsset(ownerPath, assetName, arrayBuffer);
            } else {
                const userPath = '/' + innerParts.join('/');
                await this.vfs.write(moduleName, userPath, arrayBuffer);
            }
        } catch (e) {
            console.error(`Failed to download ${meta.path}`, e);
        }
    }

    // Note: same logic as toBuffer() in @itookit/vfslib — duplicated here due to package boundary
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
            version: 2,
            timestamp: Date.now(),
            type: 'mixed_backup',
            settings: {},
            modules: [],
        };

        if (settingsKeys.includes('tags')) {
            exportData.settings.tags = this.state.tags;
        }
        if (settingsKeys.includes('contacts')) {
            exportData.settings.contacts = this.state.contacts;
        }

        for (const name of moduleNames) {
            try {
                const moduleDump = await this.vfs.maintenance.exportModule(name);
                exportData.modules.push(moduleDump);
            } catch (e) {
                console.warn(`Failed to export module ${name}`, e);
            }
        }
        return exportData;
    }

    async importMixedData(
        data: any,
        settingsKeys: (keyof SettingsState)[],
        moduleNames: string[],
        _options: { overwrite?: boolean; mergeTags?: boolean } = {}
    ): Promise<void> {
        const tasks: Promise<void>[] = [];

        // Resolve value from either new format (data.settings[k]) or legacy format (data[k])
        const resolveField = (key: string): any[] | undefined => {
            const fromSettings = data.settings?.[key];
            const fromRoot = data[key];
            const val = Array.isArray(fromSettings) ? fromSettings : (Array.isArray(fromRoot) ? fromRoot : undefined);
            return val;
        };

        // 1. 恢复配置
        const tagsData = settingsKeys.includes('tags') ? resolveField('tags') : undefined;
        if (tagsData) {
            this.state.tags = tagsData;
            tasks.push(this.saveEntity('tags'));
        }

        const contactsData = settingsKeys.includes('contacts') ? resolveField('contacts') : undefined;
        if (contactsData) {
            this.state.contacts = contactsData;
            tasks.push(this.saveEntity('contacts'));
        }

        // 2. 恢复模块
        const allModulesList = data.modules || [];
        if (Array.isArray(allModulesList)) {
            const selectedModulesData = allModulesList.filter((m: any) =>
                m.moduleName && moduleNames.includes(m.moduleName)
            );

            for (const modData of selectedModulesData) {
                try {
                    await this.vfs.maintenance.importModule(modData);
                } catch (e) {
                    console.error(`Failed to import module ${modData?.module?.name}`, e);
                }
            }
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
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

    async createFullBackup(): Promise<string> {
        return this.vfs.maintenance.createBackup();
    }

    async restoreFullBackup(jsonContent: string): Promise<void> {
        await this.vfs.maintenance.restoreBackup(jsonContent);
        this.initialized = false;
        await this.init();
    }

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
        return this.vfs
            .getAllModules()
            .filter((m) => !SYSTEM_MODULES.includes(m.name))
            .map((m) => ({ name: m.name, description: m.description }));
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

