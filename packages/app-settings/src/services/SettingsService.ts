/**
 * @file: app-settings/services/SettingsService.ts
 */
import { FS_MODULE_AGENTS } from '@itookit/common';
import { VFSCore, VFSErrorCode, VFSEventType, VFSEvent } from '@itookit/vfs-core';
import { SettingsState, Contact, Tag } from '../types';

const CONFIG_MODULE = '__config';

// 定义不向用户展示的系统内部模块
// agents 模块现在由 VFSAgentService 管理，视为系统模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui', FS_MODULE_AGENTS];
const SNAPSHOT_PREFIX = 'snapshot_';

const FILES = {
  tags: '/tags.json',
  contacts: '/contacts.json',
};

// 快照接口
export interface LocalSnapshot {
  name: string;
  displayName: string;
  timestamp: number;
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

    const eventsToWatch = [
      VFSEventType.NODE_CREATED,
      VFSEventType.NODE_DELETED,
      VFSEventType.NODE_UPDATED,
      VFSEventType.NODES_BATCH_UPDATED,
    ];

    const handler = (event: VFSEvent) => {
      // 过滤掉配置模块自身的变更，防止循环
      if (event.path && event.path.startsWith(`/${CONFIG_MODULE}`)) {
        return;
      }

      // 防抖
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTags().then(() => this.notify());
      }, 1000);
    };

    eventsToWatch.forEach((type) => {
      bus.on(type, handler);
    });
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
   * 混合导入
   */
  async importMixedData(
    data: any,
    settingsKeys: (keyof SettingsState)[],
    moduleNames: string[]
  ) {
    const tasks: Promise<void>[] = [];
    
    if (data.settings) {
      // 仅导入由 SettingsService 管理的数据
      if (settingsKeys.includes('tags') && data.settings.tags) {
        this.state.tags = data.settings.tags;
        tasks.push(this.saveEntity('tags'));
      }
      if (settingsKeys.includes('contacts') && data.settings.contacts) {
        this.state.contacts = data.settings.contacts;
        tasks.push(this.saveEntity('contacts'));
      }
    }

    const modulesList = data.modules || [];
    if (Array.isArray(modulesList)) {
      for (const modDump of modulesList) {
        const modName = modDump.module?.name;
        if (modName && moduleNames.includes(modName)) {
          try {
            // 如果模块已存在，先卸载以清除旧数据
            if (this.vfs.getModule(modName)) {
              await this.vfs.unmount(modName);
            }
            await this.vfs.importModule(modDump);
          } catch (e) {
            console.error(`Failed to import module ${modName}`, e);
          }
        }
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
            timestamp,
          });
        }
      }
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  async createSnapshot(): Promise<void> {
    const currentDbName = this.vfs.dbName;
    const timestamp = Date.now();
    const targetDbName = `${SNAPSHOT_PREFIX}${timestamp}`;
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
