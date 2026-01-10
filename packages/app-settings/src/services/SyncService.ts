// @file: app-settings/services/SyncService.ts

import { 
  SyncConfig, 
  SyncStatus, 
  SyncMode, 
  SyncConflict, 
  SyncLogEntry,
  SyncQueueItem,
} from '../types/sync';

type SyncEventHandler = (event: SyncEvent) => void;

interface SyncEvent {
  type: 'stateChange' | 'progress' | 'conflict' | 'log' | 'error' | 'connected' | 'disconnected';
  data: any;
}

/**
 * 同步服务 - 管理远程同步逻辑
 */
export class SyncService {
  private config: SyncConfig | null = null;
  private status: SyncStatus = { state: 'idle', lastSyncTime: null };
  private conflicts: SyncConflict[] = [];
  private logs: SyncLogEntry[] = [];
  private queue: SyncQueueItem[] = [];
  private eventHandlers: Map<string, Set<SyncEventHandler>> = new Map();
  
  // WebSocket 连接
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private wsReconnectAttempts = 0;
  
  // 自动同步定时器
  private autoSyncTimer: any = null;

  constructor(private storageKey: string = 'vfs_sync_config') {
    this.loadConfig();
  }

  // ==================== 配置管理 ====================

  /**
   * 加载同步配置
   */
  private loadConfig(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.config = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load sync config:', e);
    }
  }

  /**
   * 保存同步配置
   */
  async saveConfig(config: SyncConfig): Promise<void> {
    this.config = config;
    localStorage.setItem(this.storageKey, JSON.stringify(config));
    
    // 重新初始化自动同步
    this.setupAutoSync();
    
    // 如果启用了 WebSocket，重新连接
    if (config.transport === 'websocket' || config.transport === 'auto') {
      await this.reconnectWebSocket();
    }
    
    this.log('info', '同步配置已保存');
  }

  /**
   * 获取同步配置
   */
  getConfig(): SyncConfig {
    return this.config || {
      serverUrl: '',
      username: '',
      token: '',
      strategy: 'manual',
      autoSync: false
    };
  }

  /**
   * 获取同步状态
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  // ==================== 连接管理 ====================

  /**
   * 测试服务器连接
   */
  async testConnection(url: string, username: string, token: string): Promise<boolean> {
    try {
      const response = await fetch(`${url}/api/sync/ping`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Username': username
        }
      });
      
      if (response.ok) {
        this.log('success', '服务器连接成功');
        return true;
      } else {
        const error = await response.text();
        this.log('error', `连接失败: ${response.status} ${error}`);
        return false;
      }
    } catch (e: any) {
      this.log('error', `连接错误: ${e.message}`);
      throw e;
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.config?.serverUrl || !this.config?.token) {
      return;
    }

    const wsUrl = this.config.serverUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + '/api/sync/ws';

    try {
      const url = new URL(wsUrl);
      url.searchParams.set('token', this.config.token);

      this.ws = new WebSocket(url.toString());
      
      this.ws.onopen = () => {
        this.wsReconnectAttempts = 0;
        this.updateStatus({ 
          connection: { type: 'websocket', connected: true }
        });
        this.emit('connected', {});
        this.log('success', 'WebSocket 连接已建立');
      };

      this.ws.onclose = (event) => {
        this.updateStatus({
          connection: { type: 'websocket', connected: false }
        });
        this.emit('disconnected', { reason: event.reason });
        
        // 自动重连
        if (this.config?.autoSync) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this.log('error', 'WebSocket 错误');
        console.error('WebSocket error:', error);
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

    } catch (e: any) {
      this.log('error', `WebSocket 连接失败: ${e.message}`);
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'sync:changes':
          // 服务器推送变更
          this.handleRemoteChanges(message.payload);
          break;

        case 'sync:conflict':
          // 冲突通知
          this.handleConflict(message.payload);
          break;

        case 'sync:progress':
          // 进度更新
          this.updateStatus({ progress: message.payload });
          break;

        case 'ping':
          // 心跳响应
          this.ws?.send(JSON.stringify({ type: 'pong', id: message.id }));
          break;
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.wsReconnectAttempts >= 10) {
      this.log('error', '重连次数过多，停止重连');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000);
    this.wsReconnectAttempts++;

    this.log('info', `${delay / 1000}秒后尝试重连...`);

    this.wsReconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  /**
   * 重新连接 WebSocket
   */
  private async reconnectWebSocket(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }
    
    this.wsReconnectAttempts = 0;
    await this.connectWebSocket();
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }
    
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }
    
    this.updateStatus({ state: 'offline' });
  }

  // ==================== 同步操作 ====================

  /**
   * 触发同步
   */
  async triggerSync(mode: SyncMode = 'standard'): Promise<void> {
    if (!this.config?.serverUrl) {
      throw new Error('未配置服务器地址');
    }

    if (this.status.state === 'syncing') {
      throw new Error('同步正在进行中');
    }

    this.updateStatus({ state: 'syncing', progress: { phase: 'preparing', current: 0, total: 0 } });
    this.log('info', `开始${this.getModeLabel(mode)}...`);

    try {
      const endpoint = this.getSyncEndpoint(mode);
      
      const response = await fetch(`${this.config.serverUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          modules: this.config.modules || ['default'],
          strategy: this.config.strategy,
          conflictResolution: this.config.conflictResolution || 'newer-wins'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      
      this.updateStatus({
        state: 'success',
        lastSyncTime: Date.now(),
        stats: result.stats,
        progress: undefined
      });
      
      this.log('success', `同步完成: 上传 ${result.stats?.uploadedFiles || 0} 个，下载 ${result.stats?.downloadedFiles || 0} 个`);

      // 处理返回的冲突
      if (result.conflicts?.length > 0) {
        this.conflicts = result.conflicts;
        this.emit('conflict', { conflicts: result.conflicts });
      }

    } catch (e: any) {
      this.updateStatus({
        state: 'error',
        errorMessage: e.message
      });
      this.log('error', `同步失败: ${e.message}`);
      throw e;
    }
  }

  /**
   * 获取同步端点
   */
  private getSyncEndpoint(mode: SyncMode): string {
    switch (mode) {
      case 'force_push':
        return '/api/sync/force-push';
      case 'force_pull':
        return '/api/sync/force-pull';
      default:
        return '/api/sync/sync';
    }
  }

  /**
   * 获取模式标签
   */
  private getModeLabel(mode: SyncMode): string {
    switch (mode) {
      case 'force_push':
        return '强制上传';
      case 'force_pull':
        return '强制下载';
      default:
        return '同步';
    }
  }

  /**
   * 处理远程变更
   */
  private async handleRemoteChanges(changes: any[]): Promise<void> {
    this.log('info', `收到 ${changes.length} 个远程变更`);
    // 实际应用变更的逻辑由 VFS 处理
    this.emit('stateChange', { changes });
  }

  /**
   * 处理冲突
   */
  private handleConflict(conflict: SyncConflict): void {
    this.conflicts.push(conflict);
    this.emit('conflict', { conflict });
    this.log('warn', `检测到冲突: ${conflict.path}`);
  }

  /**
   * 解决冲突
   */
  async resolveConflict(conflictId: string, resolution: 'local' | 'remote'): Promise<void> {
    if (!this.config?.serverUrl) {
      throw new Error('未配置服务器');
    }

    const response = await fetch(`${this.config.serverUrl}/api/sync/conflicts/${conflictId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ resolution })
    });

    if (!response.ok) {
      throw new Error('解决冲突失败');
    }

    // 移除已解决的冲突
    this.conflicts = this.conflicts.filter(c => c.id !== conflictId);
    this.log('success', `冲突已解决: ${resolution === 'local' ? '保留本地' : '使用远程'}`);
  }

  /**
   * 获取冲突列表
   */
  getConflicts(): SyncConflict[] {
    return [...this.conflicts];
  }

  // ==================== 自动同步 ====================

  /**
   * 设置自动同步
   */
  private setupAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    if (this.config?.autoSync && this.config?.autoSyncInterval) {
      const interval = this.config.autoSyncInterval * 60 * 1000; // 转换为毫秒
      
      this.autoSyncTimer = setInterval(() => {
        this.triggerSync('standard').catch(e => {
          console.error('Auto sync failed:', e);
        });
      }, interval);
      
      this.log('info', `自动同步已启用，间隔 ${this.config.autoSyncInterval} 分钟`);
    }
  }

  // ==================== 状态和日志 ====================

  /**
   * 更新状态
   */
  private updateStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.emit('stateChange', { status: this.status });
  }

  /**
   * 添加日志
   */
  private log(level: SyncLogEntry['level'], message: string, details?: any): void {
    const entry: SyncLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details
    };
    
    this.logs.unshift(entry);
    
    // 只保留最近 100 条日志
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(0, 100);
    }
    
    this.emit('log', { entry });
  }

  /**
   * 获取日志
   */
  getLogs(limit: number = 50): SyncLogEntry[] {
    return this.logs.slice(0, limit);
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  // ==================== 事件系统 ====================

  /**
   * 订阅事件
   */
  on(event: string, handler: SyncEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * 发送事件
   */
  private emit(type: string, data: any): void {
    this.eventHandlers.get(type)?.forEach(handler => {
      try {
        handler({ type: type as any, data });
      } catch (e) {
        console.error('Event handler error:', e);
      }
    });
  }

  // ==================== 队列管理 ====================

  /**
   * 获取同步队列
   */
  getQueue(): SyncQueueItem[] {
    return [...this.queue];
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queue = [];
  }
}

// 导出单例
export const syncService = new SyncService();
