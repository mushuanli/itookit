/**
 * @file: app-settings/services/SettingsService.ts
 */
import { FS_MODULE_AGENTS } from '@itookit/common';
import { VFSCore, VFSErrorCode, VFSEventType, VFSEvent, IncrementalRestoreOptions, VNodeType } from '@itookit/vfs-core';
import { SettingsState, Contact, Tag } from '../types';

const CONFIG_MODULE = '__config';

// 定义不向用户展示的系统内部模块
// agents 模块现在由 VFSAgentService 管理，视为系统模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui', FS_MODULE_AGENTS];
const SNAPSHOT_PREFIX = 'snapshot_';

const FILES = {
  tags: '/tags.json',
  contacts: '/contacts.json',
  sync: '/sync_config.json', // [新增] 同步配置文件
};

// [新增] 同步配置接口 (Fix Error 1)
export interface SyncConfig {
  serverUrl: string;
  username: string; // Changed from apiKey
  password?: string; // Optional (store carefully)
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
  createdAt: number; // UI 使用 createdAt 而非 timestamp
  size: number;      // UI 需要 size
}

// Helper types for Sync Protocol
interface FileMeta {
    path: string;
    hash: string;
    mtime: number;
    is_deleted: boolean;
}

type ChangeListener = () => void;

/**
 * SettingsService
 * 职责：
 * 1. 管理通用应用设置（Tags, Contacts）。
 * 2. 提供系统级维护功能（快照、备份、重置）。
 * 3. 协调 VFS 配置模块的挂载。
 * 
 * 注意：LLM、Connections、Agents 相关逻辑已迁移至 VFSAgentService。
 */
export class SettingsService {
  private vfs: VFSCore;
  
  // 仅管理标签和通讯录
  private state: Pick<SettingsState, 'tags' | 'contacts'> = {
    tags: [],
    contacts: [],
  };
  
  // [新增] 同步状态缓存
  private syncConfig: SyncConfig = {
    serverUrl: '',
    username: '',
    strategy: 'manual',
    autoSync: false
  };
  private syncStatus: SyncStatus = { state: 'idle', lastSyncTime: null };

  private listeners: Set<ChangeListener> = new Set();
  private initialized = false;
  private syncTimer: any = null;

  constructor(vfs: VFSCore) {
    this.vfs = vfs;
  }

  /**
   * 初始化：挂载模块并加载通用数据
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 1. 挂载配置存储模块
    if (!this.vfs.getModule(CONFIG_MODULE)) {
      try {
        await this.vfs.mount(CONFIG_MODULE, 'Settings Persistence');
      } catch (e: any) {
        if (e.code !== VFSErrorCode.ALREADY_EXISTS) throw e;
      }
    }

    // 2. 加载数据
    await Promise.all([
      this.loadEntity('contacts'),
      this.syncTags(),
      this.loadSyncConfig(),
    ]);

    // 3. 启动 VFS 事件监听 (主要用于 Tag 计数同步)
    this.bindVFSEvents();
    
    this.initialized = true;
    this.notify();
  }

  /**
   * 监听 VFS 事件以保持 Tag 计数同步
   */
  private bindVFSEvents() {
    const bus = this.vfs.getEventBus();
    const handler = (event: VFSEvent) => {
      // 过滤掉配置模块自身的变更，防止循环
      if (event.path && event.path.startsWith(`/${CONFIG_MODULE}`)) {
        return;
      }

      // 防抖
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTags().then(() => this.notify());
        
        // Simple Auto-Sync Debounce
        if (this.syncConfig.autoSync && this.syncStatus.state !== 'syncing' && this.syncConfig.serverUrl) {
            console.log('[AutoSync] Triggered');
            this.triggerSync().catch(e => console.error('AutoSync failed', e));
        }
      }, 2000);
    };

    [VFSEventType.NODE_CREATED, VFSEventType.NODE_UPDATED, VFSEventType.NODE_DELETED].forEach(t => bus.on(t, handler));
  }

  // =========================================================
  // 通用实体存取 (Tags / Contacts)
  // =========================================================

  private async loadEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K) {
    const path = FILES[key];
    try {
      const content = await this.vfs.read(CONFIG_MODULE, path);
      const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
      this.state[key] = JSON.parse(jsonStr);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        this.state[key] = [];
      } else {
        console.error(`Failed to load ${key}`, e);
      }
    }
  }

  private async saveEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K) {
    const path = FILES[key];
    const content = JSON.stringify(this.state[key], null, 2);
    try {
      await this.vfs.write(CONFIG_MODULE, path, content);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        await this.vfs.createFile(CONFIG_MODULE, path, content);
      } else {
        throw e;
      }
    }
    // Tags 的变更通常通过 syncTags 处理通知，Contacts 需要手动通知
    if (key !== 'tags') this.notify();
  }

  // =========================================================
  // CRUD: Contacts
  // =========================================================

  getContacts() {
    return [...this.state.contacts];
  }

  async saveContact(contact: Contact) {
    this.updateOrAdd(this.state.contacts, contact);
    await this.saveEntity('contacts');
  }

  async deleteContact(id: string) {
    this.state.contacts = this.state.contacts.filter((c) => c.id !== id);
    await this.saveEntity('contacts');
    this.notify();
  }

  // =========================================================
  // CRUD: Tags
  // =========================================================

  getTags() {
    return [...this.state.tags];
  }

  /**
   * 同步标签数据：合并配置文件中的元数据（颜色、描述）与 VFS 中的引用计数
   */
  public async syncTags() {
    try {
      let configTags: Tag[] = [];
      try {
        const content = await this.vfs.read(CONFIG_MODULE, FILES.tags);
        const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
        configTags = JSON.parse(jsonStr);
      } catch (e) {
        /* ignore if file not exists or empty */
      }

      // 获取 VFS 核心统计的标签数据
      const vfsTags = await this.vfs.getAllTags();

      // 合并逻辑
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

      // 保存合并后的结果（主要为了持久化颜色和描述）
      this.saveEntity('tags').catch((err) => console.error('Failed to save merged tags', err));

      if (oldStateStr !== newStateStr && this.initialized) {
        this.notify();
      }
    } catch (e) {
      console.error('[SettingsService] Failed to sync tags:', e);
    }
  }

  async saveTag(tag: Tag) {
    // 同时更新 VFS 核心的标签定义（颜色）
    await this.vfs.updateTag(tag.name, { color: tag.color });
    this.updateOrAdd(this.state.tags, tag);
    await this.saveEntity('tags');
  }

  async deleteTag(tagId: string) {
    const tag = this.state.tags.find((t) => t.id === tagId);
    if (!tag) return;
    
    // 删除 VFS 核心定义
    await this.vfs.deleteTagDefinition(tag.name);
    
    this.state.tags = this.state.tags.filter((t) => t.id !== tagId);
    await this.saveEntity('tags');
    this.notify();
  }

  // =========================================================
  // [新增] 同步功能 (Fix Errors 3, 4, 7, 8)
  // =========================================================

  async getSyncConfig(): Promise<SyncConfig> {
    return { ...this.syncConfig };
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return { ...this.syncStatus };
  }

  async loadSyncConfig() {
      try {
        const content = await this.vfs.read(CONFIG_MODULE, FILES.sync);
        const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
        const loaded = JSON.parse(jsonStr);
        this.syncConfig = { ...this.syncConfig, ...loaded };
      } catch (e) { /* ignore */ }
  }

  async saveSyncConfig(config: SyncConfig): Promise<void> {
    this.syncConfig = config;
    try { await this.vfs.write(CONFIG_MODULE, FILES.sync, JSON.stringify(config, null, 2)); }
    catch (e: any) { if (e.code === VFSErrorCode.NOT_FOUND) await this.vfs.createFile(CONFIG_MODULE, FILES.sync, JSON.stringify(config, null, 2)); }
  }

  // Test connection by attempting to login
  async testConnection(url: string, user: string, pass: string): Promise<boolean> {
      try {
          const token = await this.performLogin(url, user, pass);
          return !!token;
      } catch (e) {
          console.error(e);
          return false;
      }
  }

  private async performLogin(baseUrl: string, username: string, password?: string): Promise<string> {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
      });
      if (!res.ok) throw new Error('Auth failed');
      const data = await res.json();
      return data.token;
  }

  /**
   * 触发同步
   * 注意：此处仅为示例实现，实际同步逻辑需要对接具体的后端 API
   */
  async triggerSync(): Promise<void> {
    if (!this.syncConfig.serverUrl) throw new Error('No server URL');
    
    try {
        this.syncStatus = { state: 'syncing', lastSyncTime: this.syncStatus.lastSyncTime };
        this.notify();

        // 1. Auth
        const token = await this.performLogin(this.syncConfig.serverUrl, this.syncConfig.username, this.syncConfig.password);

        // 2. Index Local Files
        const localFiles = await this.indexAllLocalFiles();
        
        // 3. Check Diff
        const checkRes = await fetch(`${this.syncConfig.serverUrl}/api/sync/check`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(localFiles)
        });
        
        if (!checkRes.ok) throw new Error('Sync check failed');
        const diff: { files_to_upload: string[], files_to_download: FileMeta[] } = await checkRes.json();

        // 4. Handle Uploads (Push)
        if (this.syncConfig.strategy !== 'pull') {
            for (const path of diff.files_to_upload) {
                await this.uploadFile(path, token);
            }
        }

        // 5. Handle Downloads (Pull)
        if (this.syncConfig.strategy !== 'push') {
            for (const meta of diff.files_to_download) {
                await this.downloadFile(meta, token);
            }
        }

        this.syncStatus = { state: 'success', lastSyncTime: Date.now() };
    } catch (e: any) {
        console.error('Sync Error', e);
        this.syncStatus = { state: 'error', lastSyncTime: this.syncStatus.lastSyncTime, errorMessage: e.message };
    } finally {
        this.notify();
    }
  }

  private async indexAllLocalFiles(): Promise<FileMeta[]> {
      const files: FileMeta[] = [];
      const modules = this.vfs.getAllModules().filter(m => !SYSTEM_MODULES.includes(m.name));
      
      // 获取底层 VFS 实例，以便直接使用 ID 进行高效读取
      const lowLevelVFS = this.vfs.getVFS();

      for (const mod of modules) {
          // [Fix Error 1]: 使用 getModule 获取信息，然后通过 rootNodeId 加载 VNode
          const modInfo = this.vfs.getModule(mod.name);
          if (modInfo && modInfo.rootNodeId) {
              const rootNode = await lowLevelVFS.storage.loadVNode(modInfo.rootNodeId);
              if (rootNode) {
                  await this._traverseAndIndex(lowLevelVFS, mod.name, rootNode, files);
              }
          }
      }
      return files;
  }

  private async _traverseAndIndex(vfs: any, moduleName: string, node: any, list: FileMeta[]) {
      if (node.type === VNodeType.FILE) {
          // [Fix Error 2]: 调用底层 vfs.read(nodeId)
          const content = await vfs.read(node.nodeId);
          
          let buffer: ArrayBuffer;
          if (typeof content === 'string') {
              buffer = new TextEncoder().encode(content).buffer;
          } else {
              buffer = content;
          }
          
          const hash = await this.computeSHA256(buffer);
          
          // 注意：node.path 已经是系统路径 (e.g., /module/path)，直接使用即可作为唯一标识
          list.push({
              path: node.path,
              hash: hash,
              mtime: node.modifiedAt,
              is_deleted: false
          });
      } else if (node.type === VNodeType.DIRECTORY) {
          // [Fix Error 3]: 调用底层 vfs.readdir(nodeId)
          const children = await vfs.readdir(node.nodeId);
          for (const child of children) {
              await this._traverseAndIndex(vfs, moduleName, child, list);
          }
      }
  }

  private async uploadFile(systemPath: string, token: string) {
      // 这里的 systemPath 格式为 /moduleName/path/to/file
      // 我们需要解析出 moduleName 和 relativePath 来调用高层 API 读取，
      // 或者直接使用底层的 getNodeIdByPath + read
      
      try {
          // 使用底层 API 更直接
          const lowLevelVFS = this.vfs.getVFS();
          const nodeId = await lowLevelVFS.storage.getNodeIdByPath(systemPath);
          
          if (nodeId) {
              const content = await lowLevelVFS.read(nodeId);
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

  private async downloadFile(meta: FileMeta, token: string) {
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
          
          // meta.path 是系统路径 /moduleName/relative/path
          // 解析模块名
          const parts = meta.path.split('/'); // ["", "moduleName", "file.txt"]
          const moduleName = parts[1];
          // 将系统路径转换为用户路径 (去除 /moduleName)
          const userPath = `/${parts.slice(2).join('/')}`;

          if (this.vfs.getModule(moduleName)) {
              // 使用高层 API 写入，会自动处理父目录创建
              await this.vfs.write(moduleName, userPath, arrayBuffer);
              
              // 更新元数据
              // 需要先解析出 NodeID
              const nodeId = await this.vfs.getVFS().pathResolver.resolve(moduleName, userPath);
              if (nodeId) {
                  await this.vfs.updateMetadata(moduleName, userPath, { syncedAt: meta.mtime });
              }
          }
      } catch (e) {
          console.error(`Failed to download ${meta.path}`, e);
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

  /**
   * 混合导出：支持配置项 + VFS 模块
   */
  async exportMixedData(settingsKeys: (keyof SettingsState)[], moduleNames: string[]): Promise<any> {
    const exportData: any = {
      version: 2,
      timestamp: Date.now(),
      type: 'mixed_backup',
      settings: {},
      modules: [],
    };

    // 仅导出由 SettingsService 管理的数据
    if (settingsKeys.includes('tags')) {
      exportData.settings.tags = this.state.tags;
    }
    if (settingsKeys.includes('contacts')) {
      exportData.settings.contacts = this.state.contacts;
    }

    // 导出 VFS 模块快照
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

  /**
   * [修改] 混合导入 (Fix Error 9)
   * 增加 options 参数支持，并使用 VFS 的 restoreSystemBackupIncrementally
   */
  async importMixedData(
    data: any,
    settingsKeys: (keyof SettingsState)[],
    moduleNames: string[],
    options: IncrementalRestoreOptions = {} // [新增参数]
  ) {
    const tasks: Promise<void>[] = [];
    
    // 1. 恢复配置 (Tags, Contacts) - 始终覆盖/合并内存状态
    if (data.settings) {
      if (settingsKeys.includes('tags') && data.settings.tags) {
        // Tag 比较特殊，建议合并而非直接覆盖，这里简单处理为读取
        this.state.tags = data.settings.tags; 
        tasks.push(this.saveEntity('tags'));
      }
      if (settingsKeys.includes('contacts') && data.settings.contacts) {
        this.state.contacts = data.settings.contacts;
        tasks.push(this.saveEntity('contacts'));
      }
    }

    // 2. 恢复模块 (Workspaces)
    const allModulesList = data.modules || [];
    if (Array.isArray(allModulesList)) {
      // 筛选出用户选中的模块数据
      const selectedModulesData = allModulesList.filter((m: any) => 
          m.module && moduleNames.includes(m.module.name)
      );

      if (selectedModulesData.length > 0) {
          // 构造一个临时的备份对象传递给 VFS 核心
          const partialBackup = {
              version: data.version,
              timestamp: data.timestamp,
              modules: selectedModulesData
          };

          // 调用 VFS 核心的新增量恢复接口
          // 这里会自动处理 覆盖(overwrite) vs 增量(skip/merge) 的逻辑
          await this.vfs.restoreSystemBackupIncrementally(
              JSON.stringify(partialBackup),
              options
          );
      }
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    // 导入后重新同步标签
    await this.syncTags();
    this.notify();
  }

  // =========================================================
  // 本地快照管理 (IndexedDB Level)
  // =========================================================

  // [修改] 修复 LocalSnapshot 类型不匹配 (Fix Error 5, 6)
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
            createdAt: timestamp, // 映射 timestamp -> createdAt
            size: 0 // 浏览器标准API不支持直接获取 DB 大小，暂置为 0 或需额外实现估算逻辑
          });
        }
      }
    }
    return snapshots.sort((a, b) => b.createdAt - a.createdAt);
  }
  async createSnapshot() { 
      const currentDbName = this.vfs.dbName;
      const targetDbName = `${SNAPSHOT_PREFIX}${Date.now()}`;
      await VFSCore.copyDatabase(currentDbName, targetDbName);
  }

  async restoreSnapshot(snapshotName: string): Promise<void> {
    const currentDbName = this.vfs.dbName;
    await this.vfs.shutdown();
    await VFSCore.copyDatabase(snapshotName, currentDbName);
  }

  async deleteSnapshot(snapshotName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.deleteDatabase(snapshotName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn(`Delete ${snapshotName} blocked`);
    });
  }

  // =========================================================
  // 系统级操作
  // =========================================================

  async createFullBackup(): Promise<string> {
    return this.vfs.createSystemBackup();
  }

  async restoreFullBackup(jsonContent: string): Promise<void> {
    await this.vfs.restoreSystemBackup(jsonContent);
    this.initialized = false;
    await this.init();
  }

  async factoryReset(): Promise<void> {
    await this.vfs.systemReset();
  }

  // =========================================================
  // 辅助方法 & 事件
  // =========================================================

  private updateOrAdd<T extends { id: string }>(list: T[], item: T) {
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    this.notify();
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // 获取可用于导入/导出的数据 Keys (移除了 connections/mcp)
  getAvailableSettingsKeys(): (keyof SettingsState)[] {
    return ['tags', 'contacts'];
  }

  // 获取所有用户工作区 (排除系统模块)
  getAvailableWorkspaces() {
    return this.vfs
      .getAllModules()
      .filter((m) => !SYSTEM_MODULES.includes(m.name))
      .map((m) => ({ name: m.name, description: m.description }));
  }
}
