// @file: app-settings/editors/storage/MigrationSection.ts

import { Toast, Modal } from '@itookit/common';
import { SettingsService } from '../../services/SettingsService';
import { SettingsState } from '../../types/types';
import { StorageUtils } from './StorageUtils';

const SETTINGS_LABELS: Record<keyof SettingsState, string> = {
    connections: '🤖 连接 (Connections)',
    mcpServers: '🔌 MCP 服务器',
    tags: '🏷️ 标签 (Tags)',
    contacts: '📒 通讯录'
};

export class MigrationSection {
  constructor(private container: HTMLElement, private service: SettingsService) {}

  init(): void {
    this.render();
  }

  render(): void {
    this.container.innerHTML = `
      <div class="settings-section" style="border-top: 1px solid var(--st-border-color); padding-top: 20px;">
        <h3 class="settings-section__title">📁 数据迁移</h3>
        <p class="settings-page__description" style="margin-bottom: 15px;">
          导入或导出数据用于备份、迁移或与其他设备共享
        </p>
        
        <div class="settings-storage-actions">
          <div class="settings-action-card">
            <div class="settings-action-card__icon">📤</div>
            <div class="settings-action-card__content">
              <h3>导出备份</h3>
              <p>将系统配置和文档导出为 JSON 文件</p>
            </div>
            <button id="btn-export-mixed" class="settings-btn settings-btn--secondary">
              <i class="fas fa-file-export"></i> 选择导出...
            </button>
          </div>
          
          <div class="settings-action-card">
            <div class="settings-action-card__icon">📥</div>
            <div class="settings-action-card__content">
              <h3>导入数据</h3>
              <p>从 JSON 文件恢复数据，支持增量合并</p>
            </div>
            <button id="btn-import-mixed" class="settings-btn settings-btn--primary">
              <i class="fas fa-file-import"></i> 导入文件...
            </button>
          </div>
        </div>
      </div>
    `;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-export-mixed')?.addEventListener('click', () => this.openExportModal());
    this.container.querySelector('#btn-import-mixed')?.addEventListener('click', () => this.triggerImportFlow());
  }

  private openExportModal(): void {
    const settingsKeys = this.service.getAvailableSettingsKeys();
    const workspaces = this.service.getAvailableWorkspaces();

    const settingsHtml = settingsKeys.map(key => `
      <label class="settings-checkbox-row">
        <input type="checkbox" name="export-settings" value="${key}" checked>
        <span>${SETTINGS_LABELS[key] || key}</span>
      </label>
    `).join('');

    const workspacesHtml = workspaces.length > 0
      ? workspaces.map(ws => `
          <label class="settings-checkbox-row">
            <input type="checkbox" name="export-modules" value="${ws.name}">
            <div style="display: flex; flex-direction: column;">
              <span>📂 ${ws.name}</span>
              <small style="color: var(--st-text-secondary); font-size: 0.8em;">
                ${ws.description || '用户工作区'}
              </small>
            </div>
          </label>
        `).join('')
      : '<div style="padding: 10px; color: var(--st-text-secondary); font-style: italic;">无可用工作区</div>';

    const content = `
      <div class="settings-export-modal-content" style="padding: 0 10px;">
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px 0; border-bottom: 1px solid var(--st-border-color); padding-bottom: 5px;">
            ⚙️ 系统配置
          </h4>
          <div class="settings-checklist-grid">${settingsHtml}</div>
        </div>
        <div>
          <h4 style="margin: 0 0 10px 0; border-bottom: 1px solid var(--st-border-color); padding-bottom: 5px;">
            📚 文档工作区
          </h4>
          <div class="settings-checklist-grid">${workspacesHtml}</div>
        </div>
        <div style="margin-top: 15px; text-align: right;">
          <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = true)">
            全选
          </small>
          <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = false)">
            全不选
          </small>
        </div>
      </div>
      <style>
        .settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .settings-link-btn { cursor: pointer; color: var(--st-color-primary); margin-left: 10px; }
        .settings-link-btn:hover { text-decoration: underline; }
      </style>
    `;

    new Modal('选择导出内容', content, {
      confirmText: '导出',
      onConfirm: async () => {
        const sInputs = document.querySelectorAll<HTMLInputElement>('input[name="export-settings"]:checked');
        const mInputs = document.querySelectorAll<HTMLInputElement>('input[name="export-modules"]:checked');

        const selectedSettings = Array.from(sInputs).map(i => i.value as keyof SettingsState);
        const selectedModules = Array.from(mInputs).map(i => i.value);

        if (selectedSettings.length === 0 && selectedModules.length === 0) {
          Toast.warning('请至少选择一项内容');
          return false;
        }

        try {
          const data = await this.service.exportMixedData(selectedSettings, selectedModules);
          const date = new Date().toISOString().slice(0, 10);
          StorageUtils.downloadJson(data, `backup-${date}.json`);
          Toast.success(`导出完成: ${selectedSettings.length} 项配置, ${selectedModules.length} 个工作区`);
        } catch (e: any) {
          Toast.error('导出失败: ' + e.message);
        }
        return true;
      }
    }).show();
  }

  private triggerImportFlow(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev: any) => {
        try {
          const json = JSON.parse(ev.target.result);
          this.showImportSelectionModal(json);
        } catch (err) {
          Toast.error('无法解析 JSON 文件，请检查文件格式');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  
  private showImportSelectionModal(json: any): void {
    // 分析文件内容
    const availableSettings = this.service.getAvailableSettingsKeys().filter(k => {
      return (json.settings && Array.isArray(json.settings[k])) || Array.isArray(json[k]);
    });

    let availableModules: any[] = [];
    if (json.modules && Array.isArray(json.modules)) {
      availableModules = json.modules.filter((mod: any) => {
        const name = mod.module?.name || '';
        return !['__vfs_meta__', '__config'].includes(name);
      });
    }

    if (availableSettings.length === 0 && availableModules.length === 0) {
      Toast.error('文件中未发现可识别的备份数据');
      return;
    }

    const modulesHtml = availableModules.map(mod => {
      const name = mod.module?.name || 'Unknown';
      return `
        <label class="settings-checkbox-row">
          <input type="checkbox" name="import-modules" value="${name}">
          <div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
            <span>📂 ${name}</span>
            <span class="settings-badge settings-badge--warning" 
              style="font-size: 0.7em;">覆盖</span>
          </div>
        </label>
      `;
    }).join('');

    const settingsHtml = availableSettings.map(k => `
      <label class="settings-checkbox-row">
        <input type="checkbox" name="import-settings" value="${k}" checked>
        <span>${SETTINGS_LABELS[k] || k}</span>
      </label>
    `).join('');

    const content = `
      <div class="settings-export-modal-content" style="padding: 0 5px;">
        <!-- 合并策略 -->
        <div style="background: var(--st-bg-tertiary); padding: 12px; border-radius: 6px; 
          margin-bottom: 15px; border-left: 4px solid var(--st-color-primary);">
          <h4 style="margin: 0 0 8px 0;">合并策略</h4>
          <label class="settings-checkbox-row" style="margin: 0;">
            <input type="checkbox" id="chk-overwrite-mode">
            <div>
              <span style="font-weight: bold;">覆盖现有文件</span>
              <p style="margin: 4px 0 0 0; font-size: 0.8em; color: var(--st-text-secondary);">
                默认仅添加新文件并合并元数据。勾选后将强制覆盖同名文件。
              </p>
            </div>
          </label>
        </div>

        ${modulesHtml ? `
          <div style="margin-top: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
              <h4 style="margin: 0;">📚 选择要导入的模块</h4>
              <div>
                <small class="settings-link-btn" 
                  onclick="document.querySelectorAll('input[name=import-modules]').forEach(c=>c.checked=true)">
                  全选
                </small>
                <small class="settings-link-btn" 
                  onclick="document.querySelectorAll('input[name=import-modules]').forEach(c=>c.checked=false)">
                  清空
                </small>
              </div>
            </div>
            <div class="settings-checklist-grid">${modulesHtml}</div>
          </div>
        ` : ''}

        ${settingsHtml ? `
          <div style="margin-top: 20px;">
            <h4 style="margin: 0 0 5px 0;">⚙️ 系统配置</h4>
            <p style="font-size: 0.8em; color: var(--st-text-secondary); margin: 0 0 10px 0;">
              配置项将与现有数据合并
            </p>
            <div class="settings-checklist-grid">${settingsHtml}</div>
          </div>
        ` : ''}
      </div>
      <style>
        .settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .settings-link-btn { cursor: pointer; color: var(--st-color-primary); margin-left: 10px; }
        .settings-link-btn:hover { text-decoration: underline; }
      </style>
    `;

    new Modal('导入数据', content, {
      confirmText: '开始导入',
      onConfirm: async () => {
        const sInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-settings"]:checked');
        const mInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-modules"]:checked');
        const overwriteChk = document.querySelector<HTMLInputElement>('#chk-overwrite-mode');

        const keysToImport = Array.from(sInputs).map(i => i.value as keyof SettingsState);
        const modulesToImport = Array.from(mInputs).map(i => i.value);
        const isOverwrite = overwriteChk?.checked || false;

        if (keysToImport.length === 0 && modulesToImport.length === 0) {
          Toast.warning('请至少选择一项内容');
          return false;
        }

        try {
          Toast.info('正在导入数据...');
          await this.service.importMixedData(json, keysToImport, modulesToImport, {
            overwrite: isOverwrite,
            mergeTags: true
          });
          Toast.success('导入成功，页面即将刷新...');
          setTimeout(() => window.location.reload(), 1500);
        } catch (e: any) {
          Toast.error('导入失败: ' + e.message);
        }
        return true;
      }
    }).show();
  }
}
