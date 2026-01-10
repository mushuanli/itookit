// @file: app-settings/editors/storage/SyncSection.ts

import { Toast, Modal } from '@itookit/common';
import { syncService } from '../../services/SyncService';
import { 
  SyncConfig, 
  SyncStatus, 
  SyncMode, 
  SyncConflict, 
  SyncLogEntry,
  SyncStateType // [修复 1] 添加缺少的类型导入
} from '../../types/sync';
import { StorageUtils } from './StorageUtils';

export class SyncSection {
  private syncConfig: SyncConfig;
  private syncStatus: SyncStatus;
  private syncLogs: SyncLogEntry[] = [];
  private syncConflicts: SyncConflict[] = [];
  

  private uiState = {
    showConfig: false,
    showLogs: false,
    showAdvanced: false
  };

  private unsubscribers: Array<() => void> = [];

  constructor(private container: HTMLElement) {
    this.syncConfig = syncService.getConfig();
    this.syncStatus = syncService.getStatus();
  }

  async init(): Promise<void> {
    this.syncLogs = syncService.getLogs(20);
    this.syncConflicts = syncService.getConflicts();
    this.subscribeEvents();
    this.render();
  }

  destroy(): void {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }

  private subscribeEvents(): void {
    this.unsubscribers.push(
      syncService.on('stateChange', (event) => {
        if (event.data.status) {
          this.syncStatus = event.data.status;
          // 优化：如果是 syncing 状态，可以考虑只更新进度条 DOM，这里简化为全量 render
          this.render();
        }
      }),
      syncService.on('log', () => {
        this.syncLogs = syncService.getLogs(20);
        this.updateLogsUI();
      }),
      syncService.on('conflict', (event) => {
        this.syncConflicts = syncService.getConflicts();
        this.render();
        if (event.data.conflict) Toast.warning(`检测到文件冲突: ${event.data.conflict.path}`);
      }),
      syncService.on('connected', () => Toast.success('已连接到同步服务器')),
      syncService.on('disconnected', () => {
        if (this.syncConfig.autoSync) Toast.warning('同步连接已断开，正在重连...');
      })
    );
  }

  render(): void {
    const stateInfo = this.getSyncStateInfo();
    const hasConflicts = this.syncConflicts.length > 0;

    this.container.innerHTML = `
      <div class="settings-section">
        <!-- 同步头部 -->
        <div class="sync-header">
          <div class="sync-header__info">
            <h3 class="settings-section__title" style="margin:0">☁️ 远程同步</h3>
            <div class="sync-status">
              <span class="sync-status__dot sync-status__dot--${this.syncStatus.state}"></span>
              <span>${stateInfo.label}</span>
              ${this.syncStatus.lastSyncTime ? 
                `<span>• ${StorageUtils.formatTime(this.syncStatus.lastSyncTime)}</span>` : ''}
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
              ${this.syncStatus.state === 'syncing' ? '同步中...' : '立即同步'}
            </button>
            <button id="btn-toggle-sync-config" class="settings-btn settings-btn--secondary">
              <i class="fas fa-cog"></i> 配置
            </button>
          </div>
        </div>

        <!-- 同步进度 -->
        ${this.renderSyncProgress()}

        <!-- 冲突列表 -->
        ${this.renderConflicts()}

        <!-- 同步配置面板 -->
        <div id="sync-config-panel" class="sync-config-panel ${this.uiState.showConfig ? '' : 'sync-config-panel--hidden'}">
          ${this.renderSyncConfigForm()}
        </div>
      </div>
    `;

    this.bindEvents();
  }
  
  private renderSyncProgress(): string {
    if (this.syncStatus.state !== 'syncing' || !this.syncStatus.progress) {
      return '';
    }

    const { 
        phase, 
        current, 
        total, 
        currentFile, 
        bytesTransferred: _bytesTransferred,  // 前缀下划线
        bytesTotal: _bytesTotal,              // 前缀下划线
        speed 
    } = this.syncStatus.progress;
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
          ${currentFile ? `<span title="${currentFile}">${StorageUtils.truncatePath(currentFile, 30)}</span>` : ''}
          ${speed ? `<span>${StorageUtils.formatSpeed(speed)}</span>` : ''}
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
        <h4 style="margin: 0 0 10px 0; font-size: 0.9rem;">
          <i class="fas fa-exclamation-triangle" style="color: var(--st-color-warning)"></i>
          需要解决的冲突 (${this.syncConflicts.length})
        </h4>
        ${this.syncConflicts.map(conflict => `
          <div class="sync-conflict-item" data-conflict-id="${conflict.id}">
            <div class="sync-conflict-item__icon">⚠️</div>
            <div class="sync-conflict-item__info">
              <div class="sync-conflict-item__path">${conflict.path}</div>
              <div class="sync-conflict-item__desc">
                ${this.getConflictDescription(conflict)}
              </div>
            </div>
            <div class="sync-conflict-item__actions">
              <button class="settings-btn settings-btn--sm settings-btn--secondary btn-resolve-local" 
                data-id="${conflict.id}" title="保留本地版本">
                本地
              </button>
              <button class="settings-btn settings-btn--sm settings-btn--primary btn-resolve-remote"
                data-id="${conflict.id}" title="使用远程版本">
                远程
              </button>
            </div>
          </div>
        `).join('')}
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
      'metadata': '元数据冲突'
    };
    
    const localTime = StorageUtils.formatTime(conflict.localModified);
    const remoteTime = StorageUtils.formatTime(conflict.remoteModified);
    
    return `${typeLabels[conflict.type] || conflict.type} • 本地: ${localTime} • 远程: ${remoteTime}`;
  }

  /**
   * 渲染同步配置表单
   */
  private renderSyncConfigForm(): string {
    return `
      <div class="sync-config-panel__header">
        <span class="sync-config-panel__title">同步配置</span>
        <button id="btn-close-sync-config" class="settings-btn-icon">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- 连接状态 -->
      ${this.renderConnectionStatus()}

      <!-- 服务器配置 -->
      <div class="settings-form-group">
        <label>服务器地址</label>
        <input type="text" id="inp-sync-url" class="settings-input" 
          placeholder="https://sync.example.com" 
          value="${StorageUtils.escapeHtml(this.syncConfig.serverUrl || '')}">
        <small style="color: var(--st-text-secondary); font-size: 0.75em; margin-top: 4px; display: block;">
          若使用自签名证书，请先在浏览器中访问并接受证书
        </small>
      </div>

      <div class="settings-form-row">
        <div class="settings-form-group" style="flex: 1;">
          <label>用户名</label>
          <input type="text" id="inp-sync-user" class="settings-input" 
            placeholder="username" 
            value="${StorageUtils.escapeHtml(this.syncConfig.username || '')}">
        </div>
        <div class="settings-form-group" style="flex: 1;">
          <label>Token / API Key</label>
          <input type="password" id="inp-sync-token" class="settings-input" 
            placeholder="sk-..." 
            value="${StorageUtils.escapeHtml(this.syncConfig.token || '')}">
        </div>
      </div>

      <!-- 同步策略 -->
      <div class="settings-form-row">
        <div class="settings-form-group" style="flex: 1;">
          <label>同步策略</label>
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
          <label>冲突解决</label>
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
          <label>同步间隔（分钟）</label>
          <input type="number" id="inp-sync-interval" class="settings-input" 
            min="1" max="1440" 
            value="${this.syncConfig.autoSyncInterval || 15}"
            ${!this.syncConfig.autoSync ? 'disabled' : ''}>
        </div>
      </div>

      <!-- 传输方式 -->
      <div class="settings-form-group">
        <label>传输方式</label>
        <div class="settings-form-row" style="gap: 20px; margin-bottom: 0;">
          <label class="settings-checkbox-row">
            <input type="radio" name="transport" value="auto" 
              ${this.syncConfig.transport === 'auto' ? 'checked' : ''}>
            <span>自动 (推荐)</span>
          </label>
          <label class="settings-checkbox-row">
            <input type="radio" name="transport" value="websocket"
              ${this.syncConfig.transport === 'websocket' ? 'checked' : ''}>
            <span>WebSocket</span>
          </label>
          <label class="settings-checkbox-row">
            <input type="radio" name="transport" value="http"
              ${this.syncConfig.transport === 'http' ? 'checked' : ''}>
            <span>HTTP</span>
          </label>
        </div>
      </div>

      <!-- 错误信息 -->
      ${this.syncStatus.errorMessage ? `
        <div style="color: var(--st-color-danger); font-size: 0.85em; margin-top: 10px; 
          padding: 10px; background: var(--st-color-danger-light); border-radius: 6px;">
          ❌ ${StorageUtils.escapeHtml(this.syncStatus.errorMessage)}
        </div>
      ` : ''}

      <!-- 操作按钮 -->
      <div style="display: flex; justify-content: space-between; align-items: center; 
        margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--st-border-color);">
        <button id="btn-toggle-advanced" class="settings-btn settings-btn--sm settings-btn--secondary">
          <i class="fas fa-chevron-${this.uiState.showAdvanced ? 'up' : 'down'}"></i>
          高级选项
        </button>
        <div style="display: flex; gap: 10px;">
          <button id="btn-test-conn" class="settings-btn settings-btn--sm settings-btn--secondary">
            <i class="fas fa-plug"></i> 测试连接
          </button>
          <button id="btn-save-sync" class="settings-btn settings-btn--sm settings-btn--primary">
            <i class="fas fa-save"></i> 保存配置
          </button>
        </div>
      </div>

      <!-- 高级选项 -->
      ${this.uiState.showAdvanced ? this.renderAdvancedSyncOptions() : ''}

      <!-- 同步日志 -->
      ${this.uiState.showLogs ? this.renderSyncLogs() : ''}
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
        <div class="sync-connection-status__icon">${statusIcon}</div>
        <div class="sync-connection-status__info">
          <div class="sync-connection-status__title">${statusText}</div>
          <div class="sync-connection-status__detail">
            ${typeText}${conn.latency ? ` • ${conn.latency}ms` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染高级同步选项
   */
  private renderAdvancedSyncOptions(): string {
    return `
      <div class="sync-advanced-ops" style="margin-top: 20px;">
        <div class="sync-advanced-ops__title">
          🛡️ 数据修复与强制同步
        </div>
        
        <div class="sync-advanced-ops__buttons">
          <button id="btn-force-push" class="settings-btn settings-btn--sm settings-btn--secondary" 
            title="将本地所有数据覆盖到服务器">
            <i class="fas fa-arrow-up"></i> 强制上传 (Local → Server)
          </button>
          <button id="btn-force-pull" class="settings-btn settings-btn--sm settings-btn--secondary"
            title="从服务器下载所有数据覆盖本地">
            <i class="fas fa-arrow-down"></i> 强制下载 (Server → Local)
          </button>
          <button id="btn-toggle-logs" class="settings-btn settings-btn--sm settings-btn--secondary">
            <i class="fas fa-list"></i> ${this.uiState.showLogs ? '隐藏日志' : '查看日志'}
          </button>
        </div>
        
        <small class="sync-advanced-ops__warning">
          ⚠️ 强制操作会忽略版本冲突，直接覆盖目标端的所有数据，请谨慎使用。
        </small>

        <!-- 同步过滤器 -->
        <div style="margin-top: 15px;">
          <label style="font-weight: 500; font-size: 0.9rem; display: block; margin-bottom: 8px;">
            同步过滤
          </label>
          <div class="settings-form-row">
            <label class="settings-checkbox-row">
              <input type="checkbox" id="chk-exclude-binary" 
                ${this.syncConfig.filters?.excludeBinary ? 'checked' : ''}>
              <span>排除二进制文件</span>
            </label>
            <div class="settings-form-group" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 0.8rem;">最大文件大小 (MB)</label>
              <input type="number" id="inp-max-file-size" class="settings-input" 
                min="1" max="1024" 
                value="${(this.syncConfig.filters?.maxFileSize || 100 * 1024 * 1024) / 1024 / 1024}"
                style="width: 100px;">
            </div>
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
      <div class="sync-logs" id="sync-logs-container">
        ${this.syncLogs.length === 0 ? 
          '<div style="text-align: center; color: var(--st-text-secondary); padding: 20px;">暂无日志</div>' :
          this.syncLogs.map(log => `
            <div class="sync-log-entry sync-log-entry--${log.level}">
              <span class="sync-log-entry__time">${StorageUtils.formatLogTime(log.timestamp)}</span>
              <span class="sync-log-entry__message">${StorageUtils.escapeHtml(log.message)}</span>
            </div>
          `).join('')
        }
      </div>
    `;
  }

  private bindEvents(): void {
    // 绑定事件时，注意作用域限制在 this.container 内
    const q = (sel: string) => this.container.querySelector(sel);
    
    q('#btn-sync-now')?.addEventListener('click', () => this.handleSync('standard'));
    q('#btn-toggle-config')?.addEventListener('click', () => this.toggleSyncConfig());
    q('#btn-save-sync')?.addEventListener('click', () => this.saveSyncConfig());
    // 同步操作
    q('#btn-sync-now')?.addEventListener('click', () => this.handleSync('standard'));
    q('#btn-toggle-sync-config')?.addEventListener('click', () => this.toggleSyncConfig());
    q('#btn-close-sync-config')?.addEventListener('click', () => this.toggleSyncConfig(false));
    q('#btn-save-sync')?.addEventListener('click', () => this.saveSyncConfig());
    q('#btn-test-conn')?.addEventListener('click', () => this.testConnection());
    q('#btn-toggle-advanced')?.addEventListener('click', () => this.toggleAdvancedSync());
    q('#btn-toggle-logs')?.addEventListener('click', () => this.toggleSyncLogs());
    q('#btn-force-push')?.addEventListener('click', () => this.confirmForceSync('force_push'));
    q('#btn-force-pull')?.addEventListener('click', () => this.confirmForceSync('force_pull'));

    // 自动同步复选框联动
    const autoSyncChk = this.container.querySelector('#chk-auto-sync') as HTMLInputElement;
    if (autoSyncChk) {
      autoSyncChk.addEventListener( 'change', () => {
        const intervalInput = this.container.querySelector('#inp-sync-interval') as HTMLInputElement;
        if (intervalInput) {
          intervalInput.disabled = !autoSyncChk.checked;
        }
      });
    }

    // 冲突解决
    this.container.querySelectorAll('.btn-resolve-local').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        this.resolveConflict(id, 'local');
      });
    });

    this.container.querySelectorAll('.btn-resolve-remote').forEach(btn => {
      btn.addEventListener( 'click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        this.resolveConflict(id, 'remote');
      });
    });

  }

  // 业务逻辑方法

  /**
   * 处理同步
   */
  private async handleSync(mode: SyncMode): Promise<void> {
    // 先尝试保存配置（如果面板打开）
    if (this.uiState.showConfig) {
      try {
        await this.saveSyncConfigSilent();
      } catch (e) {
        // 忽略保存错误，继续尝试同步
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
      Toast.success(mode === 'standard' ? '同步完成' : '强制同步完成');
    } catch (e: any) {
      let msg = '同步失败';
      if (e.message.includes('Failed to fetch')) {
        msg += ': 网络错误或证书未信任';
      } else {
        msg += ': ' + e.message;
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
    const message = isPush
      ? `<div style="line-height: 1.6;">
          <p>此操作将把<b>本地的所有数据</b>上传到服务器。</p>
          <p style="color: var(--st-color-danger);">服务器上已存在的数据将被<b>直接覆盖</b>！</p>
          <p>建议先创建一个快照以便回滚。</p>
        </div>`
      : `<div style="line-height: 1.6;">
          <p>此操作将从服务器下载所有数据。</p>
          <p style="color: var(--st-color-danger);">本地已存在的数据将被<b>直接覆盖</b>！</p>
          <p>建议先创建一个快照以便回滚。</p>
        </div>`;

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
      } else {
        Toast.error('认证失败，请检查用户名和 Token');
      }
    } catch (e: any) {
      if (e.message.includes('Failed to fetch')) {
        Toast.error(`连接失败: 请先在浏览器中访问服务器地址并接受证书`);
      } else {
        Toast.error('连接错误: ' + e.message);
      }
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  }

  private async saveSyncConfig(): Promise<void> {
    try {
      await this.saveSyncConfigSilent();
      Toast.success('配置已保存');
    } catch (e: any) {
      Toast.error('保存失败: ' + e.message);
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
    const excludeBinary = this.getCheckboxValue('#chk-exclude-binary');
    const maxFileSize = parseFloat(this.getInputValue('#inp-max-file-size') || '100') * 1024 * 1024;

    if (!url) {
      throw new Error('请填写服务器地址');
    }

    const config: SyncConfig = {
      serverUrl: url,
      username,
      token,
      strategy: strategy as any,
      conflictResolution: conflictResolution as any,
      autoSync,
      autoSyncInterval,
      transport,
      filters: {
        excludeBinary,
        maxFileSize
      }
    };

    await syncService.saveConfig(config);
    this.syncConfig = config;
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(conflictId: string, resolution: 'local' | 'remote'): Promise<void> {
    try {
      await syncService.resolveConflict(conflictId, resolution);
      Toast.success(`冲突已解决: ${resolution === 'local' ? '保留本地版本' : '使用远程版本'}`);
      this.syncConflicts = syncService.getConflicts();
      this.render();
    } catch (e: any) {
      Toast.error('解决冲突失败: ' + e.message);
    }
  }
  
  /**
   * 切换同步配置面板
   */
  private toggleSyncConfig(show?: boolean): void {
    this.uiState.showConfig = show !== undefined ? show : !this.uiState.showConfig;
    
    const panel = this.container.querySelector('#sync-config-panel');
    if (panel) {
      if (this.uiState.showConfig) {
        panel.classList.remove('sync-config-panel--hidden');
      } else {
        panel.classList.add('sync-config-panel--hidden');
        // 关闭时自动保存
        this.saveSyncConfigSilent().catch(() => {});
      }
    }
  }

  /**
   * 切换高级选项
   */
  private toggleAdvancedSync(): void {
    this.uiState.showAdvanced = !this.uiState.showAdvanced;
    this.render();
  }

  /**
   * 切换同步日志
   */
  private toggleSyncLogs(): void {
    this.uiState.showLogs = !this.uiState.showLogs;
    this.render();
  }

  /**
   * 更新日志 UI（不重新渲染整个页面）
   */
  private updateLogsUI(): void {
    const container = this.container.querySelector('#sync-logs-container');
    if (container && this.uiState.showLogs) {
      container.innerHTML = this.syncLogs.length === 0
        ? '<div style="text-align: center; color: var(--st-text-secondary); padding: 20px;">暂无日志</div>'
        : this.syncLogs.map(log => `
            <div class="sync-log-entry sync-log-entry--${log.level}">
              <span class="sync-log-entry__time">${StorageUtils.formatLogTime(log.timestamp)}</span>
              <span class="sync-log-entry__message">${StorageUtils.escapeHtml(log.message)}</span>
            </div>
          `).join('');
    }
  }

  /**
   * 获取同步状态信息
   */
  private getSyncStateInfo(): { label: string; color: string } {
    const stateMap: Record<SyncStateType, { label: string; color: string }> = {
      'idle': { label: '就绪', color: '#aaa' },
      'connecting': { label: '连接中...', color: 'var(--st-color-primary)' },
      'syncing': { label: '同步中...', color: 'var(--st-color-primary)' },
      'success': { label: '同步成功', color: 'var(--st-color-success)' },
      'error': { label: '同步失败', color: 'var(--st-color-danger)' },
      'offline': { label: '离线', color: 'var(--st-color-warning)' },
      'paused': { label: '已暂停', color: '#aaa' }
    };

    return stateMap[this.syncStatus.state] || { label: '未知', color: '#aaa' };
  }

  // -- tools --

  /**
   * 获取输入框值
   */
  private getInputValue(selector: string): string {
    return (this.container.querySelector(selector) as HTMLInputElement)?.value || '';
  }

  /**
   * 获取选择框值
   */
  private getSelectValue(selector: string): string {
    return (this.container.querySelector(selector) as HTMLSelectElement)?.value || '';
  }

  /**
   * 获取复选框值
   */
  private getCheckboxValue(selector: string): boolean {
    return (this.container.querySelector(selector) as HTMLInputElement)?.checked || false;
  }

  /**
   * 获取单选框值
   */
  private getRadioValue(name: string): string {
    const checked = this.container.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement;
    return checked?.value || '';
  }
}
