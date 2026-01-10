// @file: app-settings/editors/storage/DangerZoneSection.ts

import { Toast, Modal } from '@itookit/common';
import { SettingsService } from '../../services/SettingsService';
import { syncService } from '../../services/SyncService';

export class DangerZoneSection {
  constructor(private container: HTMLElement, private service: SettingsService) {}

  init(): void {
    this.render();
  }

  render(): void {
    this.container.innerHTML = `
      <div class="settings-section" style="margin-top: 40px; border-top: 1px solid var(--st-border-color); padding-top: 20px;">
        <details>
          <summary style="cursor: pointer; color: var(--st-text-secondary); font-size: 0.9em; user-select: none;">
            ⚠️ 危险操作区
          </summary>
          <div class="settings-storage-actions" style="margin-top: 15px;">
            <div class="settings-action-card settings-action-card--danger">
              <div class="settings-action-card__icon">💣</div>
              <div class="settings-action-card__content">
                <h3>恢复出厂设置</h3>
                <p>清除所有本地数据，将应用重置为初始状态</p>
              </div>
              <button id="btn-reset" class="settings-btn settings-btn--danger">
                <i class="fas fa-bomb"></i> 清空所有数据
              </button>
            </div>
            
            <div class="settings-action-card">
              <div class="settings-action-card__icon">🔄</div>
              <div class="settings-action-card__content">
                <h3>清除同步缓存</h3>
                <p>清除同步日志和临时数据，不影响实际文件</p>
              </div>
              <button id="btn-clear-sync-cache" class="settings-btn settings-btn--secondary">
                <i class="fas fa-broom"></i> 清除缓存
              </button>
            </div>
          </div>
        </details>
      </div>
    `;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-reset')?.addEventListener('click', () => this.confirmFactoryReset());
    this.container.querySelector('#btn-clear-sync-cache')?.addEventListener('click', () => this.clearSyncCache());
  }

  private confirmFactoryReset(): void {
    Modal.confirm(
      '⚠️ 恢复出厂设置',
      `<div style="line-height: 1.6;">
        <p style="color: var(--st-color-danger); font-weight: bold;">
          此操作将永久删除所有本地数据！
        </p>
        <p>包括：</p>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>所有文档和工作区</li>
          <li>系统配置和连接设置</li>
          <li>标签和元数据</li>
          <li>本地快照</li>
        </ul>
        <p>此操作<b>不可撤销</b>，请确保已备份重要数据。</p>
      </div>`,
      async () => {
        try {
          Toast.info('正在清除所有数据...');
          await this.service.factoryReset();
          Toast.success('数据已清除，页面即将刷新...');
          setTimeout(() => window.location.reload(), 1000);
        } catch (e: any) {
          Toast.error('重置失败: ' + e.message);
        }
      }
    );
  }


  /**
   * 清除同步缓存
   */
  private clearSyncCache(): void {
    Modal.confirm(
      '清除同步缓存',
      '这将清除同步日志、临时分片和队列数据，不会影响实际文件。确定继续？',
      async () => {
        try {
          syncService.clearLogs();
          //this.syncLogs = [];
          Toast.success('同步缓存已清除');
          //this.render();
        } catch (e: any) {
          Toast.error('清除失败: ' + e.message);
        }
      }
    );
  }
}
