/**
 * @file: app-settings/services/SettingsService.ts
 */
import { FS_MODULE_AGENTS } from '@itookit/common';
import {    VFSEvent } from '@itookit/vfs';
import { 
    VFS, 
    ErrorCode, 
    VFSEventType, 
    VNodeType,
    VFSError
} from '@itookit/vfs';
import { SettingsState, Contact, Tag } from '../types/types';

const CONFIG_MODULE = '__config';

// 定义不向用户展示的系统内部模块
// agents 模块现在由 VFSAgentService 管理，视为系统模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui', FS_MODULE_AGENTS];
const SNAPSHOT_PREFIX = 'snapshot_';

const FILES = {
    tags: '/tags.json',
    contacts: '/contacts.json',
    sync: '/sync_config.json',
};

// ============================================
// 类型定义
// ============================================

export type SyncMode = 'standard' | 'force_push' | 'force_pull';

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

// [修改] 快照接口 (Fix Error 5, 6)
export interface LocalSnapshot {
    name: string;
    displayName: string;
    createdAt: number;
    size: number;
    description: string;
}

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
    private vfs: VFS;
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

    constructor(vfs: VFS, dbName: string = 'MindOS') {
        this.vfs = vfs;
        this.dbName = dbName;
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
                    description: 'Settings Persistence' 
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
        if (e instanceof VFSError) {
            return e.code === ErrorCode.ALREADY_EXISTS;
        }
        return e.code === ErrorCode.ALREADY_EXISTS || 
               e.message?.includes('exists');
    }

    /**
     * 检查是否为"未找到"错误
     */
    private isNotFoundError(e: any): boolean {
        if (e instanceof VFSError) {
            return e.code === ErrorCode.NOT_FOUND;
        }
        return e.code === ErrorCode.NOT_FOUND || 
               e.message?.toLowerCase().includes('not found');
    }

    /**
     * 监听 VFS 事件以保持 Tag 计数同步
     */
    private bindVFSEvents(): void {
        const eventsToWatch: VFSEventType[] = [
            VFSEventType.NODE_CREATED,
            VFSEventType.NODE_UPDATED,
            VFSEventType.NODE_DELETED
        ];

        const handler = (event: VFSEvent) => {
            // 过滤掉配置模块自身的变更
            if (event.path && event.path.startsWith(`/${CONFIG_MODULE}`)) {
                return;
            }

            // 防抖
            if (this.syncTimer) clearTimeout(this.syncTimer);
            this.syncTimer = setTimeout(() => {
                this.syncTags().then(() => this.notify());

                // Auto-Sync
                if (this.syncConfig.autoSync && 
                    this.syncStatus.state !== 'syncing' && 
                    this.syncConfig.serverUrl) {
                    console.log('[AutoSync] Triggered');
                    this.triggerSync().catch(e => console.error('AutoSync failed', e));
                }
            }, 2000);
        };

        eventsToWatch.forEach(evt => {
            const unsubscribe = this.vfs.on(evt, handler);
            this.eventUnsubscribers.push(unsubscribe);
        });
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
        try {
            await this.vfs.write(CONFIG_MODULE, path, content);
        } catch (e: any) {
            if (this.isNotFoundError(e)) {
                await this.vfs.createFile(CONFIG_MODULE, path, content);
            } else {
                throw e;
            }
        }
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

            this.saveEntity('tags').catch((err) => 
                console.error('Failed to save merged tags', err)
            );

            if (oldStateStr !== newStateStr && this.initialized) {
                this.notify();
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
            // 尝试调用删除标签定义（如果 VFS 支持）
            const tagNodes = await this.vfs.findByTag(tag.name);
            for (const nodeId of tagNodes) {
                await this.vfs.removeTag(nodeId, tag.name);
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
        const content = JSON.stringify(config, null, 2);
        try {
            await this.vfs.write(CONFIG_MODULE, FILES.sync, content);
        } catch (e: any) {
            if (this.isNotFoundError(e)) {
                await this.vfs.createFile(CONFIG_MODULE, FILES.sync, content);
            }
        }
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
        const modules = this.vfs.getAllModules().filter(m => !SYSTEM_MODULES.includes(m.name));

        for (const mod of modules) {
            const modInfo = this.vfs.getModule(mod.name);
            if (modInfo && modInfo.rootNodeId) {
                // 使用 kernel 获取根节点
                const rootNode = await this.vfs.kernel.getNode(modInfo.rootNodeId);
                if (rootNode) {
                    await this._traverseAndIndex(mod.name, rootNode, files);
                }
            }
        }
        return files;
    }

    private async _traverseAndIndex(
        _moduleName: string, 
        node: { nodeId: string; type: any; path: string; modifiedAt: number }, 
        list: FileMeta[]
    ): Promise<void> {
        if (node.type === VNodeType.FILE) {
            // 使用 kernel 读取内容
            const content = await this.vfs.kernel.read(node.nodeId);

            let buffer: ArrayBuffer;
            if (typeof content === 'string') {
                buffer = new TextEncoder().encode(content).buffer;
            } else {
                buffer = content as ArrayBuffer;
            }

            const hash = await this.computeSHA256(buffer);

            list.push({
                path: node.path,
                hash: hash,
                mtime: node.modifiedAt,
                is_deleted: false
            });
        } else if (node.type === VNodeType.DIRECTORY) {
            // 使用 kernel 读取子节点
            const children = await this.vfs.kernel.readdir(node.nodeId);
            for (const child of children) {
                await this._traverseAndIndex(_moduleName, child, list);
            }
        }
    }

    private async uploadFile(systemPath: string, token: string): Promise<void> {
        try {
            // 使用 kernel 解析路径并读取
            const nodeId = await this.vfs.kernel.resolvePathToId(systemPath);

            if (nodeId) {
                const content = await this.vfs.kernel.read(nodeId);
                const blob = new Blob([content]);

                const formData = new FormData();
                formData.append(systemPath, blob);

                await fetch(`${this.syncConfig.serverUrl}/api/sync/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
            }
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

            // 解析系统路径: /moduleName/relative/path
            const parts = meta.path.split('/').filter(Boolean);
            const moduleName = parts[0];
            const userPath = '/' + parts.slice(1).join('/');

            if (this.vfs.getModule(moduleName)) {
                // 尝试写入，如果文件不存在则创建
                try {
                    await this.vfs.write(moduleName, userPath, arrayBuffer);
                } catch (e: any) {
                    if (this.isNotFoundError(e)) {
                        // 确保父目录存在并创建文件
                        await this.ensureParentDirectories(moduleName, userPath);
                        await this.vfs.createFile(moduleName, userPath, arrayBuffer);
                    } else {
                        throw e;
                    }
                }

                // 更新元数据
                const node = await this.vfs.getNode(moduleName, userPath);
                if (node) {
                    await this.vfs.updateMetadata(node.nodeId, { syncedAt: meta.mtime });
                }
            }
        } catch (e) {
            console.error(`Failed to download ${meta.path}`, e);
        }
    }

    /**
     * 确保父目录存在
     */
    private async ensureParentDirectories(moduleName: string, userPath: string): Promise<void> {
        const parts = userPath.split('/').filter(Boolean);
        parts.pop(); // 移除文件名

        let currentPath = '';
        for (const part of parts) {
            currentPath += '/' + part;
            const existing = await this.vfs.getNode(moduleName, currentPath);
            if (!existing) {
                try {
                    await this.vfs.createDirectory(moduleName, currentPath);
                } catch (e: any) {
                    if (!this.isAlreadyExistsError(e)) {
                        throw e;
                    }
                }
            }
        }
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
                const moduleDump = await this.vfs.exportModule(name);
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
        _options: Record<string, unknown> = {}
    ): Promise<void> {
        const tasks: Promise<void>[] = [];

        // 1. 恢复配置
        if (data.settings) {
            if (settingsKeys.includes('tags') && data.settings.tags) {
                this.state.tags = data.settings.tags;
                tasks.push(this.saveEntity('tags'));
            }
            if (settingsKeys.includes('contacts') && data.settings.contacts) {
                this.state.contacts = data.settings.contacts;
                tasks.push(this.saveEntity('contacts'));
            }
        }

        // 2. 恢复模块
        const allModulesList = data.modules || [];
        if (Array.isArray(allModulesList)) {
            const selectedModulesData = allModulesList.filter((m: any) =>
                m.module && moduleNames.includes(m.module.name)
            );

            for (const modData of selectedModulesData) {
                try {
                    await this.vfs.importModule(modData);
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
    // 本地快照管理 (IndexedDB Level)
    // =========================================================

    async listLocalSnapshots(): Promise<LocalSnapshot[]> {
        if (!window.indexedDB.databases) {
            return [];
        }
        const dbs = await window.indexedDB.databases();
        const snapshots: LocalSnapshot[] = [];
        
        for (const db of dbs) {
            if (db.name && db.name.startsWith(SNAPSHOT_PREFIX)) {
                const parts = db.name.split('_');
                const timestamp = parseInt(parts[1]);
                if (!isNaN(timestamp)) {
                    snapshots.push({
                        name: db.name,
                        displayName: new Date(timestamp).toLocaleString(),
                        createdAt: timestamp,
                        size: 0,
                        description: ''
                    });
                }
            }
        }
        return snapshots.sort((a, b) => b.createdAt - a.createdAt);
    }

    async createSnapshot(): Promise<void> {
        const targetDbName = `${SNAPSHOT_PREFIX}${Date.now()}`;
        await this.copyDatabase(this.dbName, targetDbName);
    }

    async restoreSnapshot(snapshotName: string): Promise<void> {
        await this.vfs.shutdown();
        await this.copyDatabase(snapshotName, this.dbName);
        // 注意：恢复后需要重新初始化 VFS
    }

    async deleteSnapshot(snapshotName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = window.indexedDB.deleteDatabase(snapshotName);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => console.warn(`Delete ${snapshotName} blocked`);
        });
    }

    /**
     * 复制 IndexedDB 数据库
     */
    private async copyDatabase(sourceName: string, targetName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const openReq = indexedDB.open(sourceName);

            openReq.onerror = () => reject(openReq.error);

            openReq.onsuccess = () => {
                const sourceDb = openReq.result;
                const storeNames = Array.from(sourceDb.objectStoreNames);

                // 删除目标数据库（如果存在）
                const deleteReq = indexedDB.deleteDatabase(targetName);
                deleteReq.onsuccess = deleteReq.onerror = () => {
                    // 创建目标数据库
                    const createReq = indexedDB.open(targetName, sourceDb.version);

                    createReq.onupgradeneeded = (event) => {
                        const targetDb = (event.target as IDBOpenDBRequest).result;

                        // 复制所有 object stores 的结构
                        for (const storeName of storeNames) {
                            const sourceStore = sourceDb
                                .transaction(storeName, 'readonly')
                                .objectStore(storeName);

                            const targetStore = targetDb.createObjectStore(storeName, {
                                keyPath: sourceStore.keyPath as string | string[],
                                autoIncrement: sourceStore.autoIncrement
                            });

                            // 复制索引
                            for (const indexName of Array.from(sourceStore.indexNames)) {
                                const index = sourceStore.index(indexName);
                                targetStore.createIndex(indexName, index.keyPath as string | string[], {
                                    unique: index.unique,
                                    multiEntry: index.multiEntry
                                });
                            }
                        }
                    };

                    createReq.onsuccess = async () => {
                        const targetDb = createReq.result;

                        try {
                            // 复制数据
                            for (const storeName of storeNames) {
                                await this.copyStoreData(sourceDb, targetDb, storeName);
                            }
                            sourceDb.close();
                            targetDb.close();
                            resolve();
                        } catch (e) {
                            sourceDb.close();
                            targetDb.close();
                            reject(e);
                        }
                    };

                    createReq.onerror = () => {
                        sourceDb.close();
                        reject(createReq.error);
                    };
                };
            };
        });
    }

    private copyStoreData(
        sourceDb: IDBDatabase, 
        targetDb: IDBDatabase, 
        storeName: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const sourceTx = sourceDb.transaction(storeName, 'readonly');
            const sourceStore = sourceTx.objectStore(storeName);
            const getAllReq = sourceStore.getAll();

            getAllReq.onsuccess = () => {
                const data = getAllReq.result;
                const targetTx = targetDb.transaction(storeName, 'readwrite');
                const targetStore = targetTx.objectStore(storeName);

                let completed = 0;
                const total = data.length;

                if (total === 0) {
                    resolve();
                    return;
                }

                for (const item of data) {
                    const putReq = targetStore.put(item);
                    putReq.onsuccess = () => {
                        completed++;
                        if (completed === total) {
                            resolve();
                        }
                    };
                    putReq.onerror = () => reject(putReq.error);
                }
            };

            getAllReq.onerror = () => reject(getAllReq.error);
        });
    }

    // =========================================================
    // 系统级操作
    // =========================================================

    async createFullBackup(): Promise<string> {
        return this.vfs.createBackup();
    }

    async restoreFullBackup(jsonContent: string): Promise<void> {
        await this.vfs.restoreBackup(jsonContent);
        this.initialized = false;
        await this.init();
    }

    async factoryReset(): Promise<void> {
        // 关闭 VFS
        await this.vfs.shutdown();
        
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

