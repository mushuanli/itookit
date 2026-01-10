// @file: app-settings/editors/storage/StorageOverviewSection.ts

import { StorageUtils } from './StorageUtils';
import { syncService } from '../../services/SyncService'; // 用于获取上次同步时间

export class StorageOverviewSection {
  private storageInfo: StorageEstimate | null = null;

  constructor(private container: HTMLElement) {}

  async init(): Promise<void> {
    if (navigator.storage?.estimate) {
      try {
        this.storageInfo = await navigator.storage.estimate();
      } catch (e) {
        console.error('Failed to get storage estimate:', e);
      }
    }
    this.render();
  }

  render(): void {
    const usage = this.storageInfo?.usage || 0;
    const quota = this.storageInfo?.quota || 1;
    const percent = ((usage / quota) * 100).toFixed(1);
    const usageMB = (usage / 1024 / 1024).toFixed(2);
    const quotaGB = (quota / 1024 / 1024 / 1024).toFixed(1);
    
    // 获取上次同步时间
    const lastSyncTime = syncService.getStatus().lastSyncTime;

    this.container.innerHTML = `
      <div class="settings-storage-overview">
        <div class="settings-storage-visual">
          <svg width="120" height="120" viewBox="0 0 36 36" class="settings-circular-chart">
            <path class="settings-chart-bg" 
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="settings-chart-fill" 
              stroke-dasharray="${percent}, 100" 
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <text x="18" y="20.35" class="settings-chart-text">${percent}%</text>
          </svg>
          <div class="settings-storage-stats">
            <div class="settings-stat-item">
              <span class="settings-stat-item__label">本地占用</span>
              <span class="settings-stat-item__value">${usageMB} MB</span>
            </div>
            <div class="settings-stat-item">
              <span class="settings-stat-item__label">浏览器配额</span>
              <span class="settings-stat-item__value">${quotaGB} GB</span>
            </div>
            ${lastSyncTime ? `
              <div class="settings-stat-item">
                <span class="settings-stat-item__label">上次同步</span>
                <span class="settings-stat-item__value">${StorageUtils.formatTime(lastSyncTime)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
}
