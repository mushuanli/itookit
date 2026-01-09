// @file vfs/sync/adapters/WebSocketSyncAdapter.ts

import {
  ISyncAdapter,
  SyncState,
  SyncConfig,
  SyncScope,
  SyncResult,
  ChangeRecord,
  ConflictRecord,
  RemoteConfig,
  SyncEventType
} from '../interfaces/ISyncAdapter';

/**
 * WebSocket 实时同步适配器
 * 支持实时双向同步
 */
export class WebSocketSyncAdapter implements ISyncAdapter {
  readonly name = 'websocket';

  private ws: WebSocket | null = null;
  private endpoint = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pendingRequests = new Map<string, { 
    resolve: (value: unknown) => void; 
    reject: (reason: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private listeners = new Map<SyncEventType, Set<(data: unknown) => void>>();
  private authConfig?: RemoteConfig['auth'];

  private _state: SyncState = {
    lastSyncAt: null,
    status: 'idle',
    pendingChanges: 0,
    conflicts: 0
  };

  get state(): SyncState {
    return { ...this._state };
  }

  // ==================== 连接管理 ====================

  async connect(config: RemoteConfig): Promise<void> {
    this.endpoint = config.endpoint.replace(/^http/, 'ws');
    this.authConfig = config.auth;
    
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.endpoint);
        
        if (config.auth?.token) {
          url.searchParams.set('token', config.auth.token);
        }

        this.ws = new WebSocket(url.toString());

        const connectionTimeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
          this.ws?.close();
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.reconnectAttempts = 0;
          this._state.status = 'idle';
          this.emit('sync:connected', {});
          resolve();
        };

        this.ws.onerror = (_error) => {
          clearTimeout(connectionTimeout);
          this._state.status = 'error';
          this._state.error = 'WebSocket connection failed';
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          this.handleDisconnect();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
          }
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    // 清理所有待处理请求
    for (const [_id, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      this.ws.onclose = null; // 防止触发重连
      this.ws.close();
      this.ws = null;
    }
    
    this._state.status = 'idle';
    this.emit('sync:disconnected', {});
  }

  // ==================== 同步操作 ====================

  async sync(config: SyncConfig): Promise<SyncResult> {
    this._state.status = 'syncing';
    this.emit('sync:start', { config });
    
    try {
      const result = await this.sendRequest<SyncResult>('sync', { config });
      this._state.status = 'idle';
      this._state.lastSyncAt = Date.now();
      this.emit('sync:complete', result);
      return result;
    } catch (e) {
      this._state.status = 'error';
      this._state.error = e instanceof Error ? e.message : String(e);
      this.emit('sync:error', { error: this._state.error });
      throw e;
    }
  }

  async push(scope?: SyncScope): Promise<SyncResult> {
    return this.sendRequest<SyncResult>('push', { scope });
  }

  async pull(scope?: SyncScope): Promise<SyncResult> {
    return this.sendRequest<SyncResult>('pull', { scope });
  }

  // ==================== 变更追踪 ====================

  async getPendingChanges(scope?: SyncScope): Promise<ChangeRecord[]> {
    return this.sendRequest<ChangeRecord[]>('getPendingChanges', { scope });
  }

  async trackChange(change: Omit<ChangeRecord, 'id' | 'vectorClock'>): Promise<void> {
    // 实时推送变更
    this.send({
      type: 'change',
      data: change
    });
  }

  // ==================== 冲突管理 ====================

  async getConflicts(): Promise<ConflictRecord[]> {
    return this.sendRequest<ConflictRecord[]>('getConflicts', {});
  }

  async resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote' | ConflictRecord
  ): Promise<void> {
    await this.sendRequest<void>('resolveConflict', { conflictId, resolution });
    this._state.conflicts = Math.max(0, this._state.conflicts - 1);
    this.emit('conflict:resolved', { conflictId, resolution });
  }

  // ==================== 事件 ====================

  on(event: SyncEventType, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: SyncEventType, data: unknown): void {
    this.listeners.get(event)?.forEach(h => {
      try { h(data); } catch (e) { console.error(e); }
    });
  }

  // ==================== 私有方法 ====================

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket not connected');
    }
  }

  private sendRequest<T>(method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateId();
      
      // 设置超时
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.pendingRequests.set(requestId, { 
        resolve: resolve as (value: unknown) => void, 
        reject,
        timeout
      });

      try {
        this.send({
          type: 'request',
          id: requestId,
          method,
          params
        });
      } catch (e) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(e);
      }
    });
  }

  private handleMessage(message: {
    type: string;
    id?: string;
    result?: unknown;
    error?: string;
    data?: unknown;
  }): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message);
        break;
      
      case 'change':
        // 收到远程变更
        this.emit('sync:progress', { 
          type: 'remote_change',
          change: message.data 
        });
        break;
      
      case 'conflict':
        this._state.conflicts++;
        this.emit('conflict:detected', message.data);
        break;
      
      case 'sync_complete':
        this._state.lastSyncAt = Date.now();
        this.emit('sync:complete', message.data);
        break;
      
      case 'error':
        this._state.status = 'error';
        this._state.error = message.error;
        this.emit('sync:error', { error: message.error });
        break;
        
      case 'ping':
        // 心跳响应
        this.send({ type: 'pong' });
        break;
    }
  }

  private handleResponse(message: {
    id?: string;
    result?: unknown;
    error?: string;
  }): void {
    if (!message.id) return;
    
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private handleDisconnect(): void {
    this._state.status = 'error';
    this._state.error = 'Disconnected';
    this.emit('sync:disconnected', {});
    
    // 自动重连
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      
      console.log(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(async () => {
        try {
          await this.connect({ 
            type: 'websocket', 
            endpoint: this.endpoint,
            auth: this.authConfig
          });
        } catch (e) {
          console.error('Reconnection failed:', e);
        }
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
