// @file: app-settings/editors/StorageSettingsEditor.ts

import { BaseSettingsEditor } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';
import { StorageOverviewSection } from './storage/StorageOverviewSection';
import { SyncSection } from './storage/SyncSection';
import { SnapshotSection } from './storage/SnapshotSection';
import { MigrationSection } from './storage/MigrationSection';
import { DangerZoneSection } from './storage/DangerZoneSection';

export class StorageSettingsEditor extends BaseSettingsEditor<SettingsService> {
  private sections: any[] = [];
  private isStructureInitialized = false;

  async init(container: HTMLElement): Promise<void> {
    await super.init(container);
  }

  // [修复 2] 实现抽象方法 render
  async render(): Promise<void> {
    // 防止重复初始化：
    // BaseSettingsEditor 在 Service 变更时可能会重复调用 render
    // 我们只需要在第一次渲染时构建骨架和初始化子组件
    if (this.isStructureInitialized) {
      // 可选：如果子组件支持 update/refresh，可以在这里调用
      // 例如：this.sections.forEach(s => s.render && s.render());
      // 目前子组件大多通过内部订阅更新，所以这里可以直接返回
      return;
    }

    // 1. 渲染主骨架
    this.container.innerHTML = `
      <div class="settings-page">
        <div class="settings-page__header">
          <div>
            <h2 class="settings-page__title">存储与同步</h2>
            <p class="settings-page__description">管理本地存储、远程同步和数据备份</p>
          </div>
        </div>

        <div id="section-overview"></div>
        <div id="section-sync"></div>
        <div id="section-snapshot"></div>
        <div id="section-migration"></div>
        <div id="section-danger"></div>
      </div>
    `;

    // 2. 实例化各个子组件
    const overviewEl = this.container.querySelector('#section-overview') as HTMLElement;
    const syncEl = this.container.querySelector('#section-sync') as HTMLElement;
    const snapshotEl = this.container.querySelector('#section-snapshot') as HTMLElement;
    const migrationEl = this.container.querySelector('#section-migration') as HTMLElement;
    const dangerEl = this.container.querySelector('#section-danger') as HTMLElement;

    const overviewSection = new StorageOverviewSection(overviewEl);
    const syncSection = new SyncSection(syncEl); // SyncService 是单例，内部直接引用
    const snapshotSection = new SnapshotSection(snapshotEl, this.service);
    const migrationSection = new MigrationSection(migrationEl, this.service);
    const dangerSection = new DangerZoneSection(dangerEl, this.service);

    this.sections = [overviewSection, syncSection, snapshotSection, migrationSection, dangerSection];

    // 3. 并行初始化
    await Promise.all(this.sections.map(section => section.init()));

    this.isStructureInitialized = true;
  }

  async destroy(): Promise<void> {
    this.sections.forEach(section => section.destroy && section.destroy());
    this.sections = [];
    this.isStructureInitialized = false;
    await super.destroy();
  }
}

export default StorageSettingsEditor;
