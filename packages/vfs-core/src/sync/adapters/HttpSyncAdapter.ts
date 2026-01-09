// @file vfs/sync/adapters/HttpSyncAdapter.ts

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
 * HTTP 同步适配器
 * 通过 REST API 与远程服务器同步
 */
export class HttpSyncAdapter implements ISyncAdapter {
  readonly name = 'http';
  
  private endpoint = '';
  private authToken = '';
  private authType: 'bearer' | 'basic' = 'bearer';
  private connected = false;
  private listeners = new Map<SyncEventType, Set<(data: unknown) => void>>();

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
    this.endpoint = config.endpoint;
    
    if (config.auth?.type === 'bearer') {
      this.authType = 'bearer';
      this.authToken = config.auth.token || '';
    } else if (config.auth?.type === 'basic' && config.auth.credentials) {
      this.authType = 'basic';
      const { username, password } = config.auth.credentials;
      this.authToken = btoa(`${username}:${password}`);
    }

    // 测试连接
    try {
      const response = await this.request('GET', '/ping');
      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status}`);
      }
      this.connected = true;
      this.emit('sync:connected', {});
    } catch (e) {
      this._state.status = 'error';
      this._state.error = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.authToken = '';
    this.emit('sync:disconnected', {});
  }

  // ==================== 同步操作 ====================

  async sync(config: SyncConfig): Promise<SyncResult> {
    this.ensureConnected();
    
    this._state.status = 'syncing';
    this.emit('sync:start', { config });

    try {
      const response = await this.request('POST', '/sync', {
        body: JSON.stringify({
          direction: config.direction,
          scope: config.scope,
          timeRange: config.timeRange ? {
            since: config.timeRange.since?.toISOString(),
            until: config.timeRange.until?.toISOString()
          } : undefined,
          conflictResolution: config.conflictResolution
        })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const result = await response.json();
      
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
    this.ensureConnected();
    
    const response = await this.request('POST', '/changes/push', {
      body: JSON.stringify({ scope })
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status}`);
    }

    const result = await response.json();
    
    // 处理返回的冲突
    if (result.conflicts?.length) {
      for (const conflict of result.conflicts) {
        this._state.conflicts++;
        this.emit('conflict:detected', conflict);
      }
    }

    return result;
  }

  async pull(scope?: SyncScope): Promise<SyncResult> {
    this.ensureConnected();
    
    const params = new URLSearchParams();
    if (scope?.modules) params.set('modules', scope.modules.join(','));
    if (scope?.collections) params.set('collections', scope.collections.join(','));
    
    const response = await this.request('GET', `/changes/pull?${params}`);

    if (!response.ok) {
      throw new Error(`Pull failed: ${response.status}`);
    }

    return response.json();
  }

  // ==================== 变更追踪 ====================

  async getPendingChanges(scope?: SyncScope): Promise<ChangeRecord[]> {
    this.ensureConnected();
    
    const params = new URLSearchParams();
    if (scope?.modules) params.set('modules', scope.modules.join(','));
    
    const response = await this.request('GET', `/changes/pending?${params}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get pending changes: ${response.status}`);
    }

    return response.json();
  }

  async trackChange(change: Omit<ChangeRecord, 'id' | 'vectorClock'>): Promise<void> {
    this.ensureConnected();
    
    const response = await this.request('POST', '/changes', {
      body: JSON.stringify(change)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.code === 'CONFLICT') {
        const e: Error & { code?: string; remoteVersion?: ChangeRecord } = new Error('Conflict');
        e.code = 'CONFLICT';
        e.remoteVersion = error.remoteVersion;
        throw e;
      }
      throw new Error(`Failed to track change: ${response.status}`);
    }
  }

  // ==================== 冲突管理 ====================

  async getConflicts(): Promise<ConflictRecord[]> {
    this.ensureConnected();
    
    const response = await this.request('GET', '/conflicts');
    
    if (!response.ok) {
      throw new Error(`Failed to get conflicts: ${response.status}`);
    }

    return response.json();
  }

  async resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote' | ConflictRecord
  ): Promise<void> {
    this.ensureConnected();
    
    const response = await this.request('POST', `/conflicts/${conflictId}/resolve`, {
      body: JSON.stringify({ resolution })
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve conflict: ${response.status}`);
    }
    
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

  private async request(
    method: string, 
    path: string, 
    options: RequestInit = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    };

    if (this.authToken) {
      if (this.authType === 'bearer') {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      } else {
        headers['Authorization'] = `Basic ${this.authToken}`;
      }
    }

    return fetch(`${this.endpoint}${path}`, {
      method,
      headers,
      ...options
    });
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to remote');
    }
  }
}
