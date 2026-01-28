// @file: app-settings/services/SyncService.ts

import { VFS, VFSEventType } from '@itookit/vfs';
import { SyncPlugin, SyncConfig as PluginSyncConfig, SyncState as PluginSyncState, SyncConflict } from '@itookit/vfs';
import {
  AppSyncSettings,
  SyncMode,
  SyncUIEventHandler,
  SystemLogEntry,
  AppSyncStatus,
  UISyncState,
  SyncUIEvent
} from '../types/sync';

const CONFIG_MODULE = '__config';
const SYNC_CONFIG_PATH = '/sync_config.json';

/**
 * 同步服务 - UI 层与 SyncPlugin 的桥接层
 */
export class SyncService {
  private vfs: VFS | null = null;
  private plugin: SyncPlugin | null = null;

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
  async init(vfs: VFS): Promise<void> {
    this.vfs = vfs;
    this.plugin = vfs.getPlugin<SyncPlugin>('vfs-sync') ?? null;  // 修复类型问题

    if (!this.plugin) {
      console.warn('[SyncService] SyncPlugin not found');
      this.updateStatus({ state: 'error', errorMessage: 'Sync Plugin Missing' });
      return;
    }

    await this.loadSettingsFromVFS();
    this.bindPluginEvents();

    if (this.settings?.autoSync) {
      this.startAutoSync();
    }

    this.log('info', '同步服务已初始化');
  }

  // ==================== 适配器逻辑 (Adapter Logic) ====================

  /**
   * 核心：将 PluginSyncState (VFS) 映射回 AppSyncStatus (UI)
   */
  private syncFromPluginState(pluginState: PluginSyncState): void {
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
      const exists = await this.vfs.getNode(CONFIG_MODULE, SYNC_CONFIG_PATH);
      if (exists) {
        const content = await this.vfs.read(CONFIG_MODULE, SYNC_CONFIG_PATH);
        const json = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
        this.settings = JSON.parse(json);

        // 加载后立即应用到底层插件
        if (this.plugin && this.settings) {
          await this.plugin.reconfigure(this.mapToPluginConfig(this.settings));
        }
      }
    } catch (e) {
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
    const content = JSON.stringify(settings, null, 2);
    try {
      const exists = await this.vfs.getNode(CONFIG_MODULE, SYNC_CONFIG_PATH);
      if (exists) {
        await this.vfs.write(CONFIG_MODULE, SYNC_CONFIG_PATH, content);
      } else {
        await this.vfs.createFile(CONFIG_MODULE, SYNC_CONFIG_PATH, content);
      }
    } catch (e: any) {
      // 如果模块不存在，尝试创建
      if (e.message?.includes('not found')) {
        try {
          await this.vfs.mount(CONFIG_MODULE, { description: 'Configuration Storage' });
          await this.vfs.createFile(CONFIG_MODULE, SYNC_CONFIG_PATH, content);
        } catch (mountError) {
          console.error('[SyncService] Failed to create config module', mountError);
          throw mountError;
        }
      } else {
        throw e;
      }
    }

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
    const unsub = this.vfs.onAny((type: VFSEventType | string, event: any) => {
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
    if (!this.plugin) {
      throw new Error('Sync plugin not available');
    }

    if (!this.settings?.serverUrl) {
      throw new Error('请先配置同步服务器');
    }

    this.updateStatus({ state: 'syncing', progress: undefined });
    this.log('info', `开始${this.getModeLabel(mode)}同步...`);

    try {
      await this.plugin.triggerManualSync(mode);
      this.updateStatus({ state: 'success', lastSyncTime: Date.now() });
      this.log('success', '同步完成');
    } catch (e: any) {
      this.updateStatus({ state: 'error', errorMessage: e.message });
      this.log('error', `同步失败: ${e.message}`);
      throw e;
    }
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
        const pluginState = event.data as PluginSyncState;
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
  private mapToPluginConfig(uiConfig: AppSyncSettings): PluginSyncConfig {
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
