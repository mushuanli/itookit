// @file: app-settings/services/SyncService.ts

import { CONFIG_MODULE } from '@itookit/common';
import type { IVFSManager, FSNode } from '@itookit/common';
import type { SyncConflict } from '../types/sync';
import {
  AppSyncSettings,
  SyncMode,
  SyncUIEventHandler,
  SystemLogEntry,
  AppSyncStatus,
  UISyncState,
  SyncUIEvent
} from '../types/sync';

interface FileMeta {
  path: string;
  hash: string;
  mtime: number;
  is_deleted: boolean;
}

// Sync excludes modules mounted with isSystem: true (infrastructure, not user data).

// Sync plugin is not yet available in vfslib — local stub interface
interface ISyncPlugin {
    reconfigure(config: any): Promise<void>;
    triggerManualSync(mode: string): Promise<void>;
    testConnection(url: string): Promise<boolean>;
    reconnect(): Promise<void>;
    resolveConflict(id: string, resolution: 'local' | 'remote'): Promise<void>;
    getConflicts(): Promise<SyncConflict[]>;
}

const SYNC_CONFIG_PATH = '/sync_config.json';

/**
 * 同步服务 - UI 层与 SyncPlugin 的桥接层
 */
export class SyncService {
  private vfs: IVFSManager | null = null;
  private plugin: ISyncPlugin | null = null;

  // 使用应用层配置类型
  private settings: AppSyncSettings | null = null;
  // 使用应用层状态类型
  private status: AppSyncStatus = { state: 'idle', lastSyncTime: null };

  private conflicts: SyncConflict[] = [];
  private logs: SystemLogEntry[] = []; // 系统日志
  private readonly maxLogs = 100;

  private eventHandlers: Map<string, Set<SyncUIEventHandler>> = new Map();
  private unsubscribers: Array<() => void> = [];

  // 自动同步定时器
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 单例模式
  }

  // ==================== 初始化 ====================

  /**
   * 初始化服务
   */
  async init(vfs: IVFSManager): Promise<void> {
    this.vfs = vfs;
    // SyncPlugin not yet available in vfslib — always null until implemented
    this.plugin = null;

    // Always load persisted settings regardless of plugin availability
    await this.loadSettingsFromVFS();

    if (!this.plugin) {
      console.warn('[SyncService] SyncPlugin not found — sync features unavailable');
      return;
    }

    this.bindPluginEvents();

    if (this.settings?.autoSync) {
      this.startAutoSync();
    }

    this.log('info', '同步服务已初始化');
  }

  // ==================== 适配器逻辑 (Adapter Logic) ====================

  /**
   * 核心：将 any (sync plugin state) 映射回 AppSyncStatus (UI)
   */
  private syncFromPluginState(pluginState: any): void {
    // 状态字符串映射
    const stateMap: Record<string, UISyncState> = {
      'idle': 'idle',
      'syncing': 'syncing',
      'paused': 'paused',
      'error': 'error',
      'offline': 'offline'
    };

    this.updateStatus({
      state: stateMap[pluginState.status] || 'idle',
      // 直接传递 progress 对象，因为类型兼容
      progress: pluginState.progress,
      errorMessage: pluginState.error?.message
    });

    // 同步统计信息
    if (pluginState.stats.lastSyncTime) {
      this.status.lastSyncTime = pluginState.stats.lastSyncTime;
    }
  }

  // ==================== 配置管理 ====================

  /**
   * 从 VFS 加载配置
   */
  private async loadSettingsFromVFS(): Promise<void> {
    if (!this.vfs) return;

    try {
      const content = await this.vfs.read(CONFIG_MODULE, SYNC_CONFIG_PATH);
      const json = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
      this.settings = JSON.parse(json);
      if (this.plugin && this.settings) {
        await this.plugin.reconfigure(this.mapToPluginConfig(this.settings));
      }
    } catch {
      // File not found or parse error — start with defaults
      this.settings = this.getDefaultSettings();
    }
  }

  private getDefaultSettings(): AppSyncSettings {
    return {
      serverUrl: '',
      username: '',
      token: '',
      strategy: 'manual',
      autoSync: false,
      conflictResolution: 'server-wins',
      autoSyncInterval: 15,
      transport: 'auto',
      filters: {
        excludeBinary: false,
        maxFileSize: 100 * 1024 * 1024 // 100MB
      }
    };
  }

  /**
   * 保存配置
   */
  async saveSettings(settings: AppSyncSettings): Promise<void> {
    if (!this.vfs) throw new Error('VFS not initialized');

    this.settings = settings;

    // 1. 持久化到 VFS
    // vfs.write has upsert semantics (creates file and intermediate dirs if needed)
    await this.vfs.write(CONFIG_MODULE, SYNC_CONFIG_PATH, JSON.stringify(settings, null, 2));

    // 2. ✅ 使用 applyConfigToPlugin 代替直接调用
    await this.applyConfigToPlugin(settings);

    // 3. 管理自动同步
    this.manageAutoSync(this.settings);

    this.log('info', '同步配置已更新');
  }

  /**
   * 应用配置到 Plugin
   */
  private async applyConfigToPlugin(config: AppSyncSettings): Promise<void> {
    if (!this.plugin) return;

    const pluginConfig = this.mapToPluginConfig(config);

    try {
      await this.plugin.reconfigure(pluginConfig);

      // 如果启用了实时同步，重新连接
      if (config.transport === 'websocket' || config.transport === 'auto') {
        await this.plugin.reconnect();
      }
    } catch (e) {
      console.error('[SyncService] Failed to apply config to plugin', e);
      throw e;
    }
  }

  /**
   * 管理自动同步定时器
   */
  private manageAutoSync(config: AppSyncSettings): void {
    // 清理现有定时器
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    // 如果启用自动同步，创建新定时器
    if (config.autoSync && config.autoSyncInterval && config.autoSyncInterval > 0) {
      this.startAutoSync();
    }
  }

  /**
   * 启动自动同步
   */
  private startAutoSync(): void {
    if (!this.settings?.autoSyncInterval) return;

    const intervalMs = this.settings.autoSyncInterval * 60 * 1000; // 转换为毫秒

    this.autoSyncTimer = setInterval(async () => {
      if (this.status.state === 'syncing') {
        console.log('[SyncService] Auto-sync skipped: already syncing');
        return;
      }

      if (!this.settings?.serverUrl) {
        console.log('[SyncService] Auto-sync skipped: no server configured');
        return;
      }

      try {
        this.log('info', '自动同步开始...');
        await this.triggerSync('standard');
      } catch (e: any) {
        this.log('error', `自动同步失败: ${e.message}`);
      }
    }, intervalMs);

    console.log(`[SyncService] Auto-sync enabled, interval: ${this.settings.autoSyncInterval} minutes`);
  }

  /**
   * 获取当前配置
   */
  getSettings(): AppSyncSettings {
    return this.settings || this.getDefaultSettings();
  }

  // ==================== 状态与日志 ====================

  /**
   * 获取当前状态
   */
  getStatus(): AppSyncStatus {
    return { ...this.status };
  }

  /**
   * 更新状态
   */
  private updateStatus(partial: Partial<AppSyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.emit('stateChange', { status: this.status });
  }

  /**
   * 获取日志
   */
  getLogs(limit: number = 50): SystemLogEntry[] {
    return this.logs.slice(0, limit);
  }

  /**
   * 记录日志
   */
  private log(level: SystemLogEntry['level'], message: string, details?: any): void {
    const entry: SystemLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();
    this.emit('log', { entry });
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
    this.emit('log', { cleared: true });
  }

  /**
   * 绑定 Plugin 事件
   */
  private bindPluginEvents(): void {
    if (!this.vfs) return;

    // 监听 VFS 事件总线中的同步相关事件
    const unsub = this.vfs.onAny((type: string, event: any) => {
      // 处理自定义同步事件（Plugin 通过 EventBus 发送）
      const typeStr = String(type);

      if (typeStr.startsWith('sync:')) {
        this.handlePluginEvent(typeStr, event);
      }

    });
    this.unsubscribers.push(unsub);
  }

  // ==================== 同步操作 ====================

  /**
   * 触发同步
   */
  async triggerSync(mode: SyncMode = 'standard'): Promise<void> {
    if (!this.settings?.serverUrl) throw new Error('请先配置同步服务器');
    if (!this.settings?.token)     throw new Error('请先配置 Token');

    this.updateStatus({ state: 'syncing', progress: undefined });
    this.log('info', `开始${this.getModeLabel(mode)}同步...`);

    try {
      if (this.plugin) {
        await this.plugin.triggerManualSync(mode);
      } else {
        await this.httpSync(mode);
      }
      this.updateStatus({ state: 'success', lastSyncTime: Date.now() });
      this.log('success', '同步完成');
    } catch (e: any) {
      this.updateStatus({ state: 'error', errorMessage: e.message });
      this.log('error', `同步失败: ${e.message}`);
      throw e;
    }
  }

  private async httpSync(mode: SyncMode): Promise<void> {
    const { serverUrl, token } = this.settings!;
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    const localFiles = await this.indexLocalFiles();

    let uploadPaths: string[];
    let downloadList: FileMeta[];

    if (mode === 'force_push') {
      uploadPaths = localFiles.map(f => f.path);
      downloadList = [];
    } else if (mode === 'force_pull') {
      const res = await this.fetchCheck(serverUrl, authHeaders, []);
      uploadPaths = [];
      downloadList = res.files_to_download;
    } else {
      const res = await this.fetchCheck(serverUrl, authHeaders, localFiles);
      uploadPaths = this.settings!.strategy !== 'pull' ? res.files_to_upload : [];
      downloadList = this.settings!.strategy !== 'push' ? res.files_to_download : [];
    }

    this.log('info', `计划：上传 ${uploadPaths.length} 个，下载 ${downloadList.length} 个`);

    for (const path of uploadPaths) {
      await this.httpUpload(path, serverUrl, authHeaders);
    }
    for (const meta of downloadList) {
      await this.httpDownload(meta, serverUrl, authHeaders);
    }
  }

  private async fetchCheck(
    serverUrl: string,
    headers: Record<string, string>,
    clientFiles: FileMeta[],
  ): Promise<{ files_to_upload: string[]; files_to_download: FileMeta[] }> {
    const res = await fetch(`${serverUrl}/api/sync/check`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(clientFiles),
    });
    if (!res.ok) throw new Error(`Sync check failed: ${res.status}`);
    return res.json();
  }

  private async indexLocalFiles(): Promise<FileMeta[]> {
    if (!this.vfs) return [];
    const files: FileMeta[] = [];
    const modules = this.vfs.getAllModules().filter(m => !m.isSystem);

    for (const mod of modules) {
      const engine = this.vfs.getEngine(mod.name);
      const walk = async (parentPath: string): Promise<void> => {
        const children = await engine.getChildren(parentPath, { includeAssetDirs: true, includeInternalDirs: true, includeHidden: true }) as FSNode[];
        for (const child of children) {
          if (child.type === 'file') {
            try {
              const raw = await engine.readContent(child.id);
              const buf = this.toArrayBuffer(raw);
              files.push({
                path: `/${mod.name}${child.path}`,
                hash: await this.sha256hex(buf),
                mtime: child.modifiedAt,
                is_deleted: false,
              });
            } catch { /* skip unreadable */ }
          } else if (child.type === 'directory') {
            await walk(child.id);
          }
        }
      };
      try { await walk('/'); } catch (e) {
        this.log('warn', `索引模块 ${mod.name} 失败`);
      }
    }
    return files;
  }

  private async httpUpload(
    systemPath: string,
    serverUrl: string,
    headers: Record<string, string>,
  ): Promise<void> {
    if (!this.vfs) return;
    try {
      const parts = systemPath.split('/').filter(Boolean);
      const content = await this.vfs.read(parts[0], '/' + parts.slice(1).join('/'));
      const formData = new FormData();
      formData.append(systemPath, new Blob([this.toArrayBuffer(content)]));
      await fetch(`${serverUrl}/api/sync/upload`, { method: 'POST', headers, body: formData });
    } catch (e) {
      this.log('warn', `上传失败: ${systemPath}`);
    }
  }

  private async httpDownload(
    meta: FileMeta,
    serverUrl: string,
    headers: Record<string, string>,
  ): Promise<void> {
    if (!this.vfs) return;
    try {
      const res = await fetch(`${serverUrl}/api/sync/download`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: meta.path }),
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buf = await res.arrayBuffer();
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
        await engine.assets?.putAsset(ownerPath, assetName, buf);
      } else {
        await this.vfs.write(moduleName, '/' + innerParts.join('/'), buf);
      }
    } catch (e) {
      this.log('warn', `下载失败: ${meta.path}`);
    }
  }

  private toArrayBuffer(data: string | ArrayBuffer | Uint8Array): ArrayBuffer {
    if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer;
    if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    return data;
  }

  private async sha256hex(buf: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 获取模式标签
   */
  private getModeLabel(mode: SyncMode): string {
    const labels: Record<SyncMode, string> = {
      'standard': '标准',
      'force_push': '强制上传',
      'force_pull': '强制下载'
    };
    return labels[mode] || mode;
  }

  /**
   * 测试连接
   */
  async testConnection(url: string, _user: string, token: string): Promise<boolean> {
    if (this.plugin) {
      return this.plugin.testConnection(url);
    }

    // 降级方案：使用 HTTP 测试
    try {
      const response = await fetch(`${url}/api/sync/ping`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      return response.ok;
    } catch (e) {
      console.error('[SyncService] Connection test failed', e);
      return false;
    }
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    if (!this.plugin) {
      throw new Error('Sync plugin not available');
    }

    this.log('info', '正在重新连接...');
    await this.plugin.reconnect();
  }

  // ==================== 冲突管理 ====================

  /**
   * 解决冲突
   */
  async resolveConflict(conflictId: string, resolution: 'local' | 'remote'): Promise<void> {
    if (!this.plugin) {
      throw new Error('Sync plugin not available');
    }

    await this.plugin.resolveConflict(conflictId, resolution);
    await this.refreshConflicts();

    const label = resolution === 'local' ? '保留本地版本' : '使用远程版本';
    this.log('success', `冲突已解决: ${label}`);
  }


  /**
   * 获取冲突列表
   */
  getConflicts(): SyncConflict[] {
    return this.conflicts;
  }

  /**
   * 刷新冲突列表
   */
  private async refreshConflicts(): Promise<void> {
    if (this.plugin) {
      this.conflicts = await this.plugin.getConflicts();
      this.emit('conflict', { conflicts: this.conflicts });
    }
  }


  /**
   * 批量解决冲突
   */
  async resolveAllConflicts(resolution: 'local' | 'remote'): Promise<void> {
    const conflicts = this.getConflicts();

    for (const conflict of conflicts) {
      try {
        await this.resolveConflict(conflict.conflictId, resolution);
      } catch (e) {
        console.error(`[SyncService] Failed to resolve conflict ${conflict.conflictId}`, e);
      }
    }
  }

  /**
   * 处理插件事件
   */
  private handlePluginEvent(type: string, event: any): void {
    switch (type) {
      case 'sync:state_changed':
        const pluginState = event.data as any;
        this.syncFromPluginState(pluginState);
        break;

      case 'sync:progress':
        this.updateStatus({
          state: 'syncing',
          progress: event.data
        });
        this.emit('progress', event.data);
        break;

      case 'sync:connected':
        this.updateStatus({
          connection: { type: 'websocket', connected: true }
        });
        this.log('success', '已连接到同步服务器');
        this.emit('connected', {});
        break;

      case 'sync:disconnected':
        this.updateStatus({
          connection: { type: 'websocket', connected: false }
        });
        this.log('warn', '与服务器断开连接');
        this.emit('disconnected', {});
        break;

      case 'sync:conflict':
        this.refreshConflicts();
        this.log('warn', `发现冲突: ${event.path}`);
        break;

      case 'sync:error':
        this.updateStatus({
          state: 'error',
          errorMessage: event.data?.message || '未知错误'
        });
        this.log('error', event.data?.message || '同步错误');
        this.emit('error', { message: event.data?.message });
        break;

      case 'sync:completed':
        this.updateStatus({ state: 'success', lastSyncTime: Date.now() });
        this.log('success', '同步完成');
        this.emit('completed', {});
        break;
    }
  }

  // ==================== 事件系统 ====================

  /**
   * 订阅事件
   */
  on(type: string, handler: SyncUIEventHandler): () => void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
    return () => this.eventHandlers.get(type)?.delete(handler);
  }

  /**
   * 发送事件
   */
  private emit(type: string, data: any): void {
    const event: SyncUIEvent = { type: type as SyncUIEvent['type'], data, timestamp: Date.now() };
    this.eventHandlers.get(type)?.forEach(h => h(event));
  }

  // ==================== 配置映射 ====================

  /**
   * 将 UI 配置映射到 Plugin 配置
   */
  private mapToPluginConfig(uiConfig: AppSyncSettings): any {
    return {
      moduleId: 'root',
      peerId: this.getOrCreatePeerId(),
      serverUrl: uiConfig.serverUrl,
      auth: {
        type: 'jwt',
        token: uiConfig.token
      },
      transport: uiConfig.transport === 'auto' ? 'websocket' : uiConfig.transport,
      strategy: {
        direction: this.mapStrategyToDirection(uiConfig.strategy),
        conflictResolution: uiConfig.conflictResolution,
        batchSize: 50,
        maxPacketSize: 5 * 1024 * 1024,
        maxRetries: 3,
        retryDelay: 1000,
        retryBackoff: 'exponential',
        filters: uiConfig.filters ? {
          content: {
            excludeBinary: uiConfig.filters.excludeBinary
          },
          sizeLimit: {
            maxFileSize: uiConfig.filters.maxFileSize
          },
          paths: {
            exclude: uiConfig.filters.excludePaths,
            include: uiConfig.filters.includePaths
          }
        } : undefined
      },
      chunking: {
        enabled: true,
        chunkSize: 1024 * 1024,      // 1MB
        threshold: 5 * 1024 * 1024    // 5MB
      },
      compression: {
        enabled: true,
        algorithm: 'gzip',
        minSize: 1024                 // 1KB
      },
      realtime: {
        enabled: uiConfig.transport !== 'http',
        heartbeatInterval: 30000,
        reconnectDelay: 5000,
        maxReconnectAttempts: 10
      }
    };
  }

  /**
   * 映射策略到方向
   */
  private mapStrategyToDirection(strategy: string): 'push' | 'pull' | 'bidirectional' {
    switch (strategy) {
      case 'push': return 'push';
      case 'pull': return 'pull';
      case 'bidirectional': return 'bidirectional';
      default: return 'bidirectional';
    }
  }

  /**
   * 获取或创建 Peer ID
   */
  private getOrCreatePeerId(): string {
    const storageKey = 'vfs_sync_peer_id';
    let peerId = localStorage.getItem(storageKey);

    if (!peerId) {
      peerId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(storageKey, peerId);
    }

    return peerId;
  }

  // ==================== 生命周期 ====================

  /**
   * 销毁服务
   */
  async dispose(): Promise<void> {
    // 停止自动同步
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    // 取消事件订阅
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];

    // 清理事件处理器
    this.eventHandlers.clear();

    // 清理日志
    this.logs = [];

    this.vfs = null;
    this.plugin = null;

    console.log('[SyncService] Disposed');
  }
}

// 导出单例
export const syncService = new SyncService();
