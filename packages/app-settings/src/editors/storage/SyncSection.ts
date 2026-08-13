// @file: app-settings/editors/storage/SyncSection.ts

import { Toast, Modal } from '@itookit/ui-common';
import { syncService } from '../../services/SyncService';
import { 
  AppSyncSettings,
  AppSyncStatus,
  SystemLogEntry,
  SyncMode,
  SyncUIEvent,
  UISyncState
} from '../../types/sync';
import type { SyncConflict } from '../../types/sync';
import { StorageUtils } from './StorageUtils';

/**
 * 同步配置面板组件
 */
export class SyncSection {
  private syncConfig: AppSyncSettings; // Changed type
  private syncStatus: AppSyncStatus;   // Changed type
  private syncLogs: SystemLogEntry[] = []; // Changed type
  private syncConflicts: SyncConflict[] = [];

  private uiState = {
    showConfig: false,
    showLogs: false,
    showAdvanced: false
  };

  private unsubscribers: Array<() => void> = [];
  private boundEventHandlers: Map<string, EventListener> = new Map();

  constructor(private container: HTMLElement) {
    this.syncConfig = syncService.getSettings(); // Method renamed
    this.syncStatus = syncService.getStatus();
  }

  // ==================== 生命周期 ====================

  async init(): Promise<void> {
    this.syncLogs = syncService.getLogs(20);
    this.syncConflicts = syncService.getConflicts();
    this.subscribeEvents();
    this.render();
  }

  destroy(): void {
    // 取消事件订阅
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    
    // 清理绑定的 DOM 事件
    this.boundEventHandlers.clear();
  }

  // ==================== 事件订阅 ====================

  private subscribeEvents(): void {
    this.unsubscribers.push(
      syncService.on('stateChange', (event: SyncUIEvent) => {
        if (event.data?.status) {
          this.syncStatus = event.data.status;
          this.updateStatusUI();
        }
      }),

      syncService.on('progress', (event: SyncUIEvent) => {
        if (event.data) {
          this.syncStatus = { ...this.syncStatus, progress: event.data };
          this.updateProgressUI();
        }
      }),

      syncService.on('log', (event: SyncUIEvent) => {
        if (event.data?.cleared) {
          this.syncLogs = [];
        } else {
          this.syncLogs = syncService.getLogs(20);
        }
        this.updateLogsUI();
      }),

      syncService.on('conflict', () => {
        this.syncConflicts = syncService.getConflicts();
        this.updateConflictsUI();
        
        if (this.syncConflicts.length > 0) {
          Toast.warning(`检测到 ${this.syncConflicts.length} 个文件冲突`);
        }
      }),

      syncService.on('connected', () => {
        Toast.success('已连接到同步服务器');
        this.updateConnectionUI(true);
      }),

      syncService.on('disconnected', () => {
        if (this.syncConfig.autoSync) {
          Toast.warning('同步连接已断开，正在重连...');
        }
        this.updateConnectionUI(false);
      }),

      syncService.on('error', (event: SyncUIEvent) => {
        const message = event.data?.message || '同步发生错误';
        Toast.error(message);
      }),

      syncService.on('completed', () => {
        // 状态已通过 stateChange 更新
      })
    );
  }

  // ==================== 渲染方法 ====================

  render(): void {
    const stateInfo = this.getSyncStateInfo();
    const hasConflicts = this.syncConflicts.length > 0;

    this.container.innerHTML = `
      <div class="settings-section sync-section">
        <!-- 同步头部 -->
        <div class="sync-header">
          <div class="sync-header__info">
            <h3 class="settings-section__title" style="margin:0">
              <i class="fas fa-cloud"></i> 远程同步
            </h3>
            <div class="sync-status" id="sync-status-display">
              <span class="sync-status__dot sync-status__dot--${this.syncStatus.state}"></span>
              <span class="sync-status__label">${stateInfo.label}</span>
              ${this.syncStatus.lastSyncTime ? 
                `<span class="sync-status__time">• ${StorageUtils.formatTime(this.syncStatus.lastSyncTime)}</span>` : ''}
              ${hasConflicts ? 
                `<span class="settings-badge settings-badge--warning">
                  ${this.syncConflicts.length} 个冲突
                </span>` : ''}
            </div>
          </div>
          <div class="sync-header__actions">
            <button id="btn-sync-now" class="settings-btn settings-btn--primary" 
              ${this.syncStatus.state === 'syncing' ? 'disabled' : ''}>
              <i class="fas fa-sync ${this.syncStatus.state === 'syncing' ? 'fa-spin' : ''}"></i>
              <span>${this.syncStatus.state === 'syncing' ? '同步中...' : '立即同步'}</span>
            </button>
            <button id="btn-toggle-sync-config" class="settings-btn settings-btn--secondary">
              <i class="fas fa-cog"></i>
              <span>配置</span>
            </button>
          </div>
        </div>

        <!-- 同步进度 -->
        <div id="sync-progress-container">
          ${this.renderSyncProgress()}
        </div>

        <!-- 冲突列表 -->
        <div id="sync-conflicts-container">
          ${this.renderConflicts()}
        </div>

        <!-- 同步配置面板 -->
        <div id="sync-config-panel" class="sync-config-panel ${this.uiState.showConfig ? '' : 'sync-config-panel--hidden'}">
          ${this.renderSyncConfigForm()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * 渲染同步进度
   */
  private renderSyncProgress(): string {
    if (this.syncStatus.state !== 'syncing' || !this.syncStatus.progress) {
      return '';
    }

    const { phase, current, total, currentFile, bytesTransferred, bytesTotal, speed } = this.syncStatus.progress;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    
    const phaseLabels: Record<string, string> = {
      'preparing': '准备中...',
      'uploading': '上传中...',
      'downloading': '下载中...',
      'applying': '应用变更...',
      'finalizing': '完成中...'
    };

    return `
      <div class="sync-progress">
        <div class="sync-progress__header">
          <span class="sync-progress__label">${phaseLabels[phase] || phase}</span>
          <span class="sync-progress__percentage">${percent}%</span>
        </div>
        <div class="sync-progress__bar">
          <div class="sync-progress__fill" style="width: ${percent}%"></div>
        </div>
        <div class="sync-progress__details">
          <span>${current} / ${total} 个文件</span>
          ${currentFile ? 
            `<span class="sync-progress__file" title="${StorageUtils.escapeHtml(currentFile)}">
              ${StorageUtils.truncatePath(currentFile, 30)}
            </span>` : ''}
          ${speed ? `<span class="sync-progress__speed">${StorageUtils.formatSpeed(speed)}</span>` : ''}
          ${bytesTransferred && bytesTotal ? 
            `<span class="sync-progress__bytes">
              ${StorageUtils.formatSize(bytesTransferred)} / ${StorageUtils.formatSize(bytesTotal)}
            </span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * 渲染冲突列表
   */
  private renderConflicts(): string {
    if (this.syncConflicts.length === 0) {
      return '';
    }

    return `
      <div class="sync-conflicts">
        <div class="sync-conflicts__header">
          <h4>
            <i class="fas fa-exclamation-triangle" style="color: var(--st-color-warning)"></i>
            需要解决的冲突 (${this.syncConflicts.length})
          </h4>
          ${this.syncConflicts.length > 1 ? `
            <div class="sync-conflicts__batch-actions">
              <button class="settings-btn settings-btn--sm settings-btn--secondary" id="btn-resolve-all-local">
                全部保留本地
              </button>
              <button class="settings-btn settings-btn--sm settings-btn--primary" id="btn-resolve-all-remote">
                全部使用远程
              </button>
            </div>
          ` : ''}
        </div>
        <div class="sync-conflicts__list">
          ${this.syncConflicts.map(conflict => this.renderConflictItem(conflict)).join('')}
        </div>
      </div>
    `;
  }

  /**
   * 渲染单个冲突项
   */
  private renderConflictItem(conflict: SyncConflict): string {
    const typeIcons: Record<string, string> = {
      'content': '📄',
      'delete': '🗑️',
      'move': '📁',
      'metadata': '🏷️',
      'create': '✨',
      'update': '✏️'
    };

    return `
      <div class="sync-conflict-item" data-conflict-id="${conflict.conflictId}">
        <div class="sync-conflict-item__icon">${typeIcons[conflict.type] || '⚠️'}</div>
        <div class="sync-conflict-item__info">
          <div class="sync-conflict-item__path" title="${StorageUtils.escapeHtml(conflict.path)}">
            ${StorageUtils.truncatePath(conflict.path, 40)}
          </div>
          <div class="sync-conflict-item__desc">
            ${this.getConflictDescription(conflict)}
          </div>
        </div>
        <div class="sync-conflict-item__actions">
          <button class="settings-btn settings-btn--sm settings-btn--secondary btn-resolve-conflict" 
            data-id="${conflict.conflictId}" data-resolution="local" title="保留本地版本">
            <i class="fas fa-laptop"></i> 本地
          </button>
          <button class="settings-btn settings-btn--sm settings-btn--primary btn-resolve-conflict"
            data-id="${conflict.conflictId}" data-resolution="remote" title="使用远程版本">
            <i class="fas fa-cloud"></i> 远程
          </button>
        </div>
      </div>
    `;
  }

  /**
   * 获取冲突描述
   */
  private getConflictDescription(conflict: SyncConflict): string {
    const typeLabels: Record<string, string> = {
      'content': '内容冲突',
      'delete': '删除冲突',
      'move': '移动冲突',
      'metadata': '属性冲突',
      'create': '创建冲突',
      'update': '更新冲突'
    };
    
    const localTime = StorageUtils.formatTime(conflict.localChange.timestamp);
    const remoteTime = StorageUtils.formatTime(conflict.remoteChange.timestamp);
    
    let sizeInfo = '';
    if (conflict.localChange.size !== undefined && conflict.remoteChange.size !== undefined) {
      sizeInfo = ` | 本地 ${StorageUtils.formatSize(conflict.localChange.size)}, 远程 ${StorageUtils.formatSize(conflict.remoteChange.size)}`;
    }
    
    return `${typeLabels[conflict.type] || conflict.type} • 本地: ${localTime} • 远程: ${remoteTime}${sizeInfo}`;
  }

  /**
   * 渲染同步配置表单
   */
  private renderSyncConfigForm(): string {
    return `
      <div class="sync-config-panel__header">
        <span class="sync-config-panel__title">
          <i class="fas fa-cog"></i> 同步配置
        </span>
        <button id="btn-close-sync-config" class="settings-btn-icon" title="关闭">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="sync-config-panel__body">
        <!-- 连接状态 -->
        <div id="connection-status-container">
          ${this.renderConnectionStatus()}
        </div>

        <!-- 服务器配置 -->
        <div class="settings-form-group">
          <label for="inp-sync-url">
            <i class="fas fa-server"></i> 服务器地址
          </label>
          <input type="text" id="inp-sync-url" class="settings-input" 
            placeholder="https://sync.example.com" 
            value="${StorageUtils.escapeHtml(this.syncConfig.serverUrl || '')}">
          <small class="settings-form-hint">
            使用自签名证书时，请先在浏览器中访问并接受证书
          </small>
        </div>

        <div class="settings-form-row">
          <div class="settings-form-group" style="flex: 1;">
            <label for="inp-sync-user">
              <i class="fas fa-user"></i> 用户名
            </label>
            <input type="text" id="inp-sync-user" class="settings-input" 
              placeholder="username" 
              value="${StorageUtils.escapeHtml(this.syncConfig.username || '')}">
          </div>
          <div class="settings-form-group" style="flex: 1;">
            <label for="inp-sync-token">
              <i class="fas fa-key"></i> Token / API Key
            </label>
            <div class="settings-input-group">
              <input type="password" id="inp-sync-token" class="settings-input" 
                placeholder="sk-..." 
                value="${StorageUtils.escapeHtml(this.syncConfig.token || '')}">
              <button type="button" id="btn-toggle-token-visibility" class="settings-btn-icon" title="显示/隐藏">
                <i class="fas fa-eye"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- 同步策略 -->
        <div class="settings-form-row">
          <div class="settings-form-group" style="flex: 1;">
            <label for="sel-sync-strategy">
              <i class="fas fa-exchange-alt"></i> 同步策略
            </label>
            <select id="sel-sync-strategy" class="settings-select">
              <option value="manual" ${this.syncConfig.strategy === 'manual' ? 'selected' : ''}>
                手动同步 (Manual)
              </option>
              <option value="bidirectional" ${this.syncConfig.strategy === 'bidirectional' ? 'selected' : ''}>
                双向智能 (Bidirectional)
              </option>
              <option value="push" ${this.syncConfig.strategy === 'push' ? 'selected' : ''}>
                仅上传 (Push Only)
              </option>
              <option value="pull" ${this.syncConfig.strategy === 'pull' ? 'selected' : ''}>
                仅下载 (Pull Only)
              </option>
            </select>
          </div>
          <div class="settings-form-group" style="flex: 1;">
            <label for="sel-conflict-resolution">
              <i class="fas fa-code-branch"></i> 冲突解决
            </label>
            <select id="sel-conflict-resolution" class="settings-select">
              <option value="newer-wins" ${this.syncConfig.conflictResolution === 'newer-wins' ? 'selected' : ''}>
                较新优先 (Newer Wins)
              </option>
              <option value="server-wins" ${this.syncConfig.conflictResolution === 'server-wins' ? 'selected' : ''}>
                服务器优先 (Server Wins)
              </option>
              <option value="client-wins" ${this.syncConfig.conflictResolution === 'client-wins' ? 'selected' : ''}>
                本地优先 (Client Wins)
              </option>
              <option value="manual" ${this.syncConfig.conflictResolution === 'manual' ? 'selected' : ''}>
                手动解决 (Manual)
              </option>
            </select>
          </div>
        </div>

        <!-- 自动同步 -->
        <div class="settings-form-row" style="align-items: center;">
          <label class="settings-checkbox-row" style="flex: 1;">
            <input type="checkbox" id="chk-auto-sync" ${this.syncConfig.autoSync ? 'checked' : ''}>
            <span>启用自动同步</span>
          </label>
          <div class="settings-form-group" style="flex: 1; margin-bottom: 0;">
            <label for="inp-sync-interval">同步间隔（分钟）</label>
            <input type="number" id="inp-sync-interval" class="settings-input" 
              min="1" max="1440" 
              value="${this.syncConfig.autoSyncInterval || 15}"
              ${!this.syncConfig.autoSync ? 'disabled' : ''}>
          </div>
        </div>

        <!-- 传输方式 -->
        <div class="settings-form-group">
          <label><i class="fas fa-network-wired"></i> 传输方式</label>
          <div class="settings-radio-group">
            <label class="settings-radio-row">
              <input type="radio" name="transport" value="auto" 
                ${this.syncConfig.transport === 'auto' ? 'checked' : ''}>
              <span>自动 (推荐)</span>
            </label>
            <label class="settings-radio-row">
              <input type="radio" name="transport" value="websocket"
                ${this.syncConfig.transport === 'websocket' ? 'checked' : ''}>
              <span>WebSocket (实时)</span>
            </label>
            <label class="settings-radio-row">
              <input type="radio" name="transport" value="http"
                ${this.syncConfig.transport === 'http' ? 'checked' : ''}>
              <span>HTTP (轮询)</span>
            </label>
          </div>
        </div>

        <!-- 错误信息 -->
        ${this.syncStatus.errorMessage ? `
          <div class="sync-error-message">
            <i class="fas fa-exclamation-circle"></i>
            <span>${StorageUtils.escapeHtml(this.syncStatus.errorMessage)}</span>
          </div>
        ` : ''}

        <!-- 操作按钮 -->
        <div class="sync-config-panel__actions">
          <button id="btn-toggle-advanced" class="settings-btn settings-btn--sm settings-btn--text">
            <i class="fas fa-chevron-${this.uiState.showAdvanced ? 'up' : 'down'}"></i>
            <span>高级选项</span>
          </button>
          <div class="sync-config-panel__buttons">
            <button id="btn-test-conn" class="settings-btn settings-btn--sm settings-btn--secondary">
              <i class="fas fa-plug"></i> 测试连接
            </button>
            <button id="btn-save-sync" class="settings-btn settings-btn--sm settings-btn--primary">
              <i class="fas fa-save"></i> 保存配置
            </button>
          </div>
        </div>

        <!-- 高级选项 -->
        <div id="advanced-options-container" class="${this.uiState.showAdvanced ? '' : 'hidden'}">
          ${this.renderAdvancedSyncOptions()}
        </div>

        <!-- 同步日志 -->
        <div id="sync-logs-section" class="${this.uiState.showLogs ? '' : 'hidden'}">
          ${this.renderSyncLogs()}
        </div>
      </div>
    `;
  }

  /**
   * 渲染连接状态
   */
  private renderConnectionStatus(): string {
    const conn = this.syncStatus.connection;
    
    if (!conn) {
      return '';
    }

    const statusClass = conn.connected ? 'connected' : 'disconnected';
    const statusIcon = conn.connected ? '✅' : '❌';
    const statusText = conn.connected ? '已连接' : '未连接';
    const typeText = conn.type === 'websocket' ? 'WebSocket' : 'HTTP';

    return `
      <div class="sync-connection-status sync-connection-status--${statusClass}">
        <div class="sync-connection-status__indicator">
          <i class="fas fa-${statusIcon}"></i>
        </div>
        <div class="sync-connection-status__info">
          <span class="sync-connection-status__title">${statusText}</span>
          <span class="sync-connection-status__detail">
            ${typeText}${conn.latency ? ` • 延迟 ${conn.latency}ms` : ''}
          </span>
        </div>
        ${!conn.connected ? `
          <button id="btn-reconnect" class="settings-btn settings-btn--sm settings-btn--secondary">
            <i class="fas fa-redo"></i> 重连
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * 渲染高级同步选项
   */
  private renderAdvancedSyncOptions(): string {
    const filters = this.syncConfig.filters || {};
    const maxFileSizeMB = (filters.maxFileSize || 100 * 1024 * 1024) / 1024 / 1024;

    return `
      <div class="sync-advanced-options">
        <div class="sync-advanced-options__section">
          <h5><i class="fas fa-filter"></i> 同步过滤</h5>
          
          <div class="settings-form-row">
            <label class="settings-checkbox-row">
              <input type="checkbox" id="chk-exclude-binary" 
                ${filters.excludeBinary ? 'checked' : ''}>
              <span>排除二进制文件</span>
            </label>
          </div>
          
          <div class="settings-form-row">
            <div class="settings-form-group" style="flex: 1;">
              <label for="inp-max-file-size">最大文件大小 (MB)</label>
              <input type="number" id="inp-max-file-size" class="settings-input" 
                min="1" max="1024" step="1"
                value="${maxFileSizeMB}"
                style="width: 120px;">
            </div>
          </div>

          <div class="settings-form-group">
            <label for="inp-exclude-paths">排除路径 (每行一个)</label>
            <textarea id="inp-exclude-paths" class="settings-textarea" rows="3" 
              placeholder="/temp/**&#10;*.log&#10;/cache/**">${(filters.excludePaths || []).join('\n')}</textarea>
          </div>
        </div>

        <div class="sync-advanced-options__section">
          <h5><i class="fas fa-tools"></i> 数据修复与强制同步</h5>
          
          <div class="sync-advanced-options__buttons">
            <button id="btn-force-push" class="settings-btn settings-btn--sm settings-btn--warning" 
              title="将本地所有数据覆盖到服务器">
              <i class="fas fa-arrow-up"></i> 强制上传
            </button>
            <button id="btn-force-pull" class="settings-btn settings-btn--sm settings-btn--warning"
              title="从服务器下载所有数据覆盖本地">
              <i class="fas fa-arrow-down"></i> 强制下载
            </button>
            <button id="btn-toggle-logs" class="settings-btn settings-btn--sm settings-btn--secondary">
              <i class="fas fa-list"></i> ${this.uiState.showLogs ? '隐藏日志' : '查看日志'}
            </button>
          </div>
          
          <div class="sync-advanced-options__warning">
            <i class="fas fa-exclamation-triangle"></i>
            <span>强制操作会忽略版本冲突，直接覆盖目标端的所有数据，请谨慎使用。</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染同步日志
   */
  private renderSyncLogs(): string {
    return `
      <div class="sync-logs">
        <div class="sync-logs__header">
          <h5><i class="fas fa-history"></i> 同步日志</h5>
          <button id="btn-clear-logs" class="settings-btn settings-btn--sm settings-btn--text" 
            ${this.syncLogs.length === 0 ? 'disabled' : ''}>
            <i class="fas fa-trash"></i> 清空
          </button>
        </div>
        <div class="sync-logs__container" id="sync-logs-list">
          ${this.renderLogEntries()}
        </div>
      </div>
    `;
  }

  /**
   * 渲染日志条目
   */
  private renderLogEntries(): string {
    if (this.syncLogs.length === 0) {
      return '<div class="sync-logs__empty">暂无日志</div>';
    }

    return this.syncLogs.map(log => `
      <div class="sync-log-entry sync-log-entry--${log.level}">
        <span class="sync-log-entry__icon">${this.getLogIcon(log.level)}</span>
        <span class="sync-log-entry__time">${StorageUtils.formatLogTime(log.timestamp)}</span>
        <span class="sync-log-entry__message">${StorageUtils.escapeHtml(log.message)}</span>
      </div>
    `).join('');
  }

  /**
   * 获取日志图标
   */
  private getLogIcon(level: SystemLogEntry['level']): string {
    const icons: Record<string, string> = {
      'info': 'ℹ️',
      'success': '✅',
      'warn': '⚠️',
      'error': '❌'
    };
    return icons[level] || 'ℹ️';
  }

  // ==================== 事件绑定 ====================

  private bindEvents(): void {
    // 主要操作按钮
    this.bindClick('#btn-sync-now', () => this.handleSync('standard'));
    this.bindClick('#btn-toggle-sync-config', () => this.toggleSyncConfig());
    this.bindClick('#btn-close-sync-config', () => this.toggleSyncConfig(false));
    
    // 配置操作
    this.bindClick('#btn-save-sync', () => this.saveSyncConfig());
    this.bindClick('#btn-test-conn', () => this.testConnection());
    this.bindClick('#btn-reconnect', () => this.handleReconnect());
    
    // 高级选项
    this.bindClick('#btn-toggle-advanced', () => this.toggleAdvanced());
    this.bindClick('#btn-toggle-logs', () => this.toggleLogs());
    this.bindClick('#btn-clear-logs', () => this.clearLogs());
    this.bindClick('#btn-force-push', () => this.confirmForceSync('force_push'));
    this.bindClick('#btn-force-pull', () => this.confirmForceSync('force_pull'));

    // Token 可见性切换
    this.bindClick('#btn-toggle-token-visibility', () => this.toggleTokenVisibility());

    // 自动同步复选框联动
    this.bindChange('#chk-auto-sync', (checked: boolean) => {
      const intervalInput = this.container.querySelector('#inp-sync-interval') as HTMLInputElement;
      if (intervalInput) {
        intervalInput.disabled = !checked;
      }
    });

    // 冲突解决按钮
    this.container.querySelectorAll('.btn-resolve-conflict').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const id = target.dataset.id!;
        const resolution = target.dataset.resolution as 'local' | 'remote';
        this.resolveConflict(id, resolution);
      });
    });

    // 批量解决冲突
    this.bindClick('#btn-resolve-all-local', () => this.resolveAllConflicts('local'));
    this.bindClick('#btn-resolve-all-remote', () => this.resolveAllConflicts('remote'));
  }

  /**
   * 绑定点击事件
   */
  private bindClick(selector: string, handler: () => void): void {
    const element = this.container.querySelector(selector);
    if (element) {
      element.addEventListener('click', handler);
    }
  }

  /**
   * 绑定变更事件
   */
  private bindChange(selector: string, handler: (checked: boolean) => void): void {
    const element = this.container.querySelector(selector) as HTMLInputElement;
    if (element) {
      element.addEventListener('change', () => handler(element.checked));
    }
  }

  // ==================== UI 更新方法 ====================

  /**
   * 更新状态 UI（不重新渲染整个页面）
   */
  private updateStatusUI(): void {
    const stateInfo = this.getSyncStateInfo();
    const statusDisplay = this.container.querySelector('#sync-status-display');
    
    if (statusDisplay) {
      const hasConflicts = this.syncConflicts.length > 0;
      statusDisplay.innerHTML = `
        <span class="sync-status__dot sync-status__dot--${this.syncStatus.state}"></span>
        <span class="sync-status__label">${stateInfo.label}</span>
        ${this.syncStatus.lastSyncTime ? 
          `<span class="sync-status__time">• ${StorageUtils.formatTime(this.syncStatus.lastSyncTime)}</span>` : ''}
        ${hasConflicts ? 
          `<span class="settings-badge settings-badge--warning">
            ${this.syncConflicts.length} 个冲突
          </span>` : ''}
      `;
    }

    // 更新同步按钮状态
    const syncBtn = this.container.querySelector('#btn-sync-now') as HTMLButtonElement;
    if (syncBtn) {
      syncBtn.disabled = this.syncStatus.state === 'syncing';
      const icon = syncBtn.querySelector('i');
      const text = syncBtn.querySelector('span');
      
      if (icon) {
        icon.className = `fas fa-sync ${this.syncStatus.state === 'syncing' ? 'fa-spin' : ''}`;
      }
      if (text) {
        text.textContent = this.syncStatus.state === 'syncing' ? '同步中...' : '立即同步';
      }
    }

    // 更新错误信息
    this.updateErrorUI();
  }

  /**
   * 更新进度 UI
   */
  private updateProgressUI(): void {
    const container = this.container.querySelector('#sync-progress-container');
    if (container) {
      container.innerHTML = this.renderSyncProgress();
    }
  }

  /**
   * 更新冲突 UI
   */
  private updateConflictsUI(): void {
    const container = this.container.querySelector('#sync-conflicts-container');
    if (container) {
      container.innerHTML = this.renderConflicts();
      
      // 重新绑定冲突解决事件
      container.querySelectorAll('.btn-resolve-conflict').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const id = target.dataset.id!;
          const resolution = target.dataset.resolution as 'local' | 'remote';
          this.resolveConflict(id, resolution);
        });
      });

      this.bindClick('#btn-resolve-all-local', () => this.resolveAllConflicts('local'));
      this.bindClick('#btn-resolve-all-remote', () => this.resolveAllConflicts('remote'));
    }
  }

  /**
   * 更新日志 UI
   */
  private updateLogsUI(): void {
    const container = this.container.querySelector('#sync-logs-list');
    if (container && this.uiState.showLogs) {
      container.innerHTML = this.renderLogEntries();
    }
  }

  /**
   * 更新连接状态 UI
   */
  private updateConnectionUI(connected: boolean): void {
    const container = this.container.querySelector('#connection-status-container');
    if (container) {
      this.syncStatus.connection = {
        type: this.syncConfig.transport === 'http' ? 'http' : 'websocket',
        connected
      };
      container.innerHTML = this.renderConnectionStatus();
      
      // 重新绑定重连按钮
      this.bindClick('#btn-reconnect', () => this.handleReconnect());
    }
  }

  /**
   * 更新错误信息 UI
   */
  private updateErrorUI(): void {
    const existingError = this.container.querySelector('.sync-error-message');
    const configBody = this.container.querySelector('.sync-config-panel__body');
    
    if (this.syncStatus.errorMessage) {
      const errorHtml = `
        <div class="sync-error-message">
          <i class="fas fa-exclamation-circle"></i>
          <span>${StorageUtils.escapeHtml(this.syncStatus.errorMessage)}</span>
          <button class="sync-error-message__dismiss" title="关闭">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      
      if (existingError) {
        existingError.outerHTML = errorHtml;
      } else if (configBody) {
        // 插入到配置面板的适当位置
        const actionsDiv = configBody.querySelector('.sync-config-panel__actions');
        if (actionsDiv) {
          actionsDiv.insertAdjacentHTML('beforebegin', errorHtml);
        }
      }

      // 绑定关闭按钮
      const dismissBtn = this.container.querySelector('.sync-error-message__dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          this.syncStatus.errorMessage = undefined;
          this.updateErrorUI();
        });
      }
    } else if (existingError) {
      existingError.remove();
    }
  }

  // ==================== 业务逻辑方法 ====================

  /**
   * 处理同步
   */
  private async handleSync(mode: SyncMode): Promise<void> {
    // 如果配置面板打开，先尝试保存配置
    if (this.uiState.showConfig) {
      try {
        await this.saveSyncConfigSilent();
      } catch (e) {
        // 忽略保存错误，继续尝试同步
        console.warn('[SyncSection] Config save failed before sync', e);
      }
    }

    // 检查配置
    if (!this.syncConfig.serverUrl) {
      Toast.warning('请先配置同步服务器');
      this.toggleSyncConfig(true);
      return;
    }

    try {
      await syncService.triggerSync(mode);
      
      if (mode === 'standard') {
        Toast.success('同步完成');
      } else {
        Toast.success(`${mode === 'force_push' ? '强制上传' : '强制下载'}完成`);
      }
    } catch (e: any) {
      let msg = '同步失败';
      
      if (e.message?.includes('Failed to fetch')) {
        msg += ': 网络错误或证书未信任';
      } else if (e.message?.includes('401') || e.message?.includes('Unauthorized')) {
        msg += ': 认证失败，请检查 Token';
      } else if (e.message?.includes('timeout')) {
        msg += ': 连接超时';
      } else {
        msg += ': ' + (e.message || '未知错误');
      }
      
      Toast.error(msg);
    }
  }

  /**
   * 确认强制同步
   */
  private confirmForceSync(mode: SyncMode): void {
    const isPush = mode === 'force_push';
    const title = isPush ? '⚠️ 确认强制上传？' : '⚠️ 确认强制下载？';
    
    const message = `
      <div class="modal-content-warning">
        <p>${isPush 
          ? '此操作将把<strong>本地的所有数据</strong>上传到服务器。'
          : '此操作将从服务器下载所有数据。'
        }</p>
        <p class="text-danger">
          <i class="fas fa-exclamation-triangle"></i>
          ${isPush 
            ? '服务器上已存在的数据将被<strong>直接覆盖</strong>！'
            : '本地已存在的数据将被<strong>直接覆盖</strong>！'
          }
        </p>
        <p class="text-muted">建议先创建一个快照以便回滚。</p>
      </div>
    `;


    Modal.confirm(title, message, async () => {
      await this.handleSync(mode);
    });
  }

  /**
   * 测试连接
   */
  private async testConnection(): Promise<void> {
    const btn = this.container.querySelector('#btn-test-conn') as HTMLButtonElement;
    if (!btn) return;

    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 连接中...';
    btn.disabled = true;

    try {
      const url = this.getInputValue('#inp-sync-url').trim().replace(/\/$/, '');
      const user = this.getInputValue('#inp-sync-user').trim();
      const token = this.getInputValue('#inp-sync-token').trim();

      if (!url) {
        Toast.warning('请填写服务器地址');
        return;
      }

      const success = await syncService.testConnection(url, user, token);
      
      if (success) {
        Toast.success('连接成功！服务器响应正常');
        this.updateConnectionUI(true);
      } else {
        Toast.error('认证失败，请检查用户名和 Token');
        this.updateConnectionUI(false);
      }
    } catch (e: any) {
      let errorMsg = '连接错误';
      
      if (e.message?.includes('Failed to fetch')) {
        errorMsg = '连接失败: 请检查网络或在浏览器中接受证书';
      } else if (e.message?.includes('CORS')) {
        errorMsg = '连接失败: 服务器未启用跨域支持';
      } else {
        errorMsg = '连接错误: ' + e.message;
      }
      
      Toast.error(errorMsg);
      this.updateConnectionUI(false);
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  }

  /**
   * 处理重新连接
   */
  private async handleReconnect(): Promise<void> {
    const btn = this.container.querySelector('#btn-reconnect') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 连接中...';
    }

    try {
      await syncService.reconnect();
      Toast.success('重新连接成功');
    } catch (e: any) {
      Toast.error('重新连接失败: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-redo"></i> 重连';
      }
    }
  }

  /**
   * 保存同步配置
   */
  private async saveSyncConfig(): Promise<void> {
    const btn = this.container.querySelector('#btn-save-sync') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
    }

    try {
      await this.saveSyncConfigSilent();
      Toast.success('配置已保存');
    } catch (e: any) {
      Toast.error('保存失败: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 保存配置';
      }
    }
  }

  /**
   * 静默保存同步配置
   */
  private async saveSyncConfigSilent(): Promise<void> {
    const url = this.getInputValue('#inp-sync-url').trim().replace(/\/$/, '');
    const username = this.getInputValue('#inp-sync-user').trim();
    const token = this.getInputValue('#inp-sync-token').trim();
    const strategy = this.getSelectValue('#sel-sync-strategy');
    const conflictResolution = this.getSelectValue('#sel-conflict-resolution');
    const autoSync = this.getCheckboxValue('#chk-auto-sync');
    const autoSyncInterval = parseInt(this.getInputValue('#inp-sync-interval') || '15', 10);
    const transport = this.getRadioValue('transport') as 'auto' | 'websocket' | 'http';
    
    // 高级选项
    const excludeBinary = this.getCheckboxValue('#chk-exclude-binary');
    const maxFileSize = parseFloat(this.getInputValue('#inp-max-file-size') || '100') * 1024 * 1024;
    const excludePathsText = this.getTextareaValue('#inp-exclude-paths');
    const excludePaths = excludePathsText
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (!url) {
      throw new Error('请填写服务器地址');
    }

    // 验证 URL 格式
    try {
      new URL(url);
    } catch {
      throw new Error('服务器地址格式无效');
    }

     const config: AppSyncSettings = {
      serverUrl: url,
      username,
      token,
      strategy: strategy as AppSyncSettings['strategy'],
      conflictResolution: conflictResolution as AppSyncSettings['conflictResolution'],
      autoSync,
      autoSyncInterval: Math.max(1, Math.min(1440, autoSyncInterval)),
      transport,
      filters: {
        excludeBinary,
        maxFileSize,
        excludePaths: excludePaths.length > 0 ? excludePaths : undefined
      }
    };

    await syncService.saveSettings(config);
    this.syncConfig = config;
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(conflictId: string, resolution: 'local' | 'remote'): Promise<void> {
    const btn = this.container.querySelector(`[data-id="${conflictId}"][data-resolution="${resolution}"]`) as HTMLButtonElement;
    
    if (btn) {
      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
      try {
        await syncService.resolveConflict(conflictId, resolution);
        this.syncConflicts = syncService.getConflicts();
        this.updateConflictsUI();
        this.updateStatusUI();
        
        Toast.success(`冲突已解决: ${resolution === 'local' ? '保留本地版本' : '使用远程版本'}`);
      } catch (e: any) {
        Toast.error('解决冲突失败: ' + e.message);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }
  }

  /**
   * 批量解决所有冲突
   */
  private async resolveAllConflicts(resolution: 'local' | 'remote'): Promise<void> {
    const label = resolution === 'local' ? '保留本地' : '使用远程';
    
    Modal.confirm(
      '批量解决冲突',
      `确定要将所有 ${this.syncConflicts.length} 个冲突都${label}吗？`,
      async () => {
        try {
          await syncService.resolveAllConflicts(resolution);
          this.syncConflicts = syncService.getConflicts();
          this.updateConflictsUI();
          this.updateStatusUI();
          Toast.success(`已${label}解决所有冲突`);
        } catch (e: any) {
          Toast.error('批量解决冲突失败: ' + e.message);
        }
      }
    );
  }

  /**
   * 清空日志
   */
  private clearLogs(): void {
    syncService.clearLogs();
    this.syncLogs = [];
    this.updateLogsUI();
    Toast.info('日志已清空');
  }

  // ==================== UI 切换方法 ====================

  /**
   * 切换同步配置面板
   */
  private toggleSyncConfig(show?: boolean): void {
    this.uiState.showConfig = show !== undefined ? show : !this.uiState.showConfig;
    
    const panel = this.container.querySelector('#sync-config-panel');
    if (panel) {
      if (this.uiState.showConfig) {
        panel.classList.remove('sync-config-panel--hidden');
        // 刷新配置表单
        this.syncConfig = syncService.getSettings();
      } else {
        panel.classList.add('sync-config-panel--hidden');
        // 关闭时自动保存
        this.saveSyncConfigSilent().catch(e => {
          console.warn('[SyncSection] Auto-save on close failed', e);
        });
      }
    }

    // 更新按钮状态
    const toggleBtn = this.container.querySelector('#btn-toggle-sync-config');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this.uiState.showConfig);
    }
  }

  /**
   * 切换高级选项
   */
  private toggleAdvanced(): void {
    this.uiState.showAdvanced = !this.uiState.showAdvanced;
    
    const container = this.container.querySelector('#advanced-options-container');
    const btn = this.container.querySelector('#btn-toggle-advanced');
    
    if (container) {
      container.classList.toggle('hidden', !this.uiState.showAdvanced);
    }
    
    if (btn) {
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = `fas fa-chevron-${this.uiState.showAdvanced ? 'up' : 'down'}`;
      }
    }
  }

  /**
   * 切换同步日志
   */
  private toggleLogs(): void {
    this.uiState.showLogs = !this.uiState.showLogs;
    
    const section = this.container.querySelector('#sync-logs-section');
    const btn = this.container.querySelector('#btn-toggle-logs');
    
    if (section) {
      section.classList.toggle('hidden', !this.uiState.showLogs);
      if (this.uiState.showLogs) {
        this.syncLogs = syncService.getLogs(50);
        section.innerHTML = this.renderSyncLogs();
        this.bindClick('#btn-clear-logs', () => this.clearLogs());
      }
    }
    
    if (btn) {
      const text = btn.querySelector('span') || btn;
      if (text.textContent) {
        text.textContent = this.uiState.showLogs ? '隐藏日志' : '查看日志';
      }
    }
  }

  /**
   * 切换 Token 可见性
   */
  private toggleTokenVisibility(): void {
    const input = this.container.querySelector('#inp-sync-token') as HTMLInputElement;
    const btn = this.container.querySelector('#btn-toggle-token-visibility');
    
    if (input && btn) {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = `fas fa-eye${isPassword ? '-slash' : ''}`;
      }
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取同步状态信息
   */
  private getSyncStateInfo(): { label: string; color: string } {
    const stateMap: Record<UISyncState, { label: string; color: string }> = {
      'idle': { label: '就绪', color: 'var(--st-color-text-secondary)' },
      'connecting': { label: '连接中...', color: 'var(--st-color-primary)' },
      'syncing': { label: '同步中...', color: 'var(--st-color-primary)' },
      'success': { label: '同步成功', color: 'var(--st-color-success)' },
      'error': { label: '同步失败', color: 'var(--st-color-danger)' },
      'offline': { label: '离线', color: 'var(--st-color-warning)' },
      'paused': { label: '已暂停', color: 'var(--st-color-text-secondary)' }
    };

    return stateMap[this.syncStatus.state] || { label: '未知', color: 'var(--st-color-text-secondary)' };
  }

  /**
   * 获取输入框值
   */
  private getInputValue(selector: string): string {
    const input = this.container.querySelector(selector) as HTMLInputElement;
    return input?.value || '';
  }

  /**
   * 获取选择框值
   */
  private getSelectValue(selector: string): string {
    const select = this.container.querySelector(selector) as HTMLSelectElement;
    return select?.value || '';
  }

  /**
   * 获取复选框值
   */
  private getCheckboxValue(selector: string): boolean {
    const checkbox = this.container.querySelector(selector) as HTMLInputElement;
    return checkbox?.checked || false;
  }

  /**
   * 获取单选框值
   */
  private getRadioValue(name: string): string {
    const checked = this.container.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement;
    return checked?.value || '';
  }

  /**
   * 获取文本域值
   */
  private getTextareaValue(selector: string): string {
    const textarea = this.container.querySelector(selector) as HTMLTextAreaElement;
    return textarea?.value || '';
  }
}
