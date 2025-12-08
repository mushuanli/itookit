// @file: app-settings/editors/StorageSettingsEditor.ts
import { BaseSettingsEditor, Modal, Toast } from '@itookit/common';
import { SettingsService, LocalSnapshot } from '../services/SettingsService'; // 引入具体 Service
import { SettingsState } from '../types';

const SETTINGS_LABELS: Record<keyof SettingsState, string> = {
    connections: '🤖 连接 (Connections)',
    mcpServers: '🔌 MCP 服务器',
    tags: '🏷️ 标签 (Tags)',
    contacts: '📒 通讯录'
};

export class StorageSettingsEditor extends BaseSettingsEditor<SettingsService> {
    private storageInfo: any = null;
    private snapshots: LocalSnapshot[] = []; 

    async init(container: HTMLElement) {
        await super.init(container);
        await Promise.all([
            this.loadStorageInfo(),
            this.loadSnapshots()
        ]);
    }

    async loadStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                this.storageInfo = await navigator.storage.estimate();
                // 仅更新部分UI或整体重绘
                this.render();
            } catch (e) { console.error(e); }
        }
    }

    // [新增] 加载快照
    async loadSnapshots() {
        try {
            this.snapshots = await this.service.listLocalSnapshots();
            this.render();
        } catch (e) {
            console.error('Failed to list snapshots', e);
        }
    }

    render() {
        const usage = this.storageInfo?.usage || 0;
        const quota = this.storageInfo?.quota || 1;
        const percent = ((usage / quota) * 100).toFixed(1);
        const usageMB = (usage / 1024 / 1024).toFixed(2);

        // 2. [核心修复] 安全获取 Snapshots，防止 undefined
        const snapshots = this.snapshots || [];

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <h2 class="settings-page__title">存储与备份</h2>
                </div>

                <div class="settings-storage-overview">
                    <div class="settings-storage-visual">
                        <svg width="120" height="120" viewBox="0 0 36 36" class="settings-circular-chart">
                            <path class="settings-chart-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path class="settings-chart-fill" stroke-dasharray="${percent}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <text x="18" y="20.35" class="settings-chart-text">${percent}%</text>
                        </svg>
                        <div>
                            <div class="settings-stat-item">
                                <span class="settings-detail-item__label">已用空间</span>
                                <span class="settings-detail-item__value">${usageMB} MB</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 统一的数据管理 -->
                <div class="settings-section">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <div>
                            <h3 class="settings-section__title" style="margin:0">⚡️ 秒级快照</h3>
                            <p class="settings-page__description" style="margin:5px 0 0 0">在浏览器内部直接复制数据库，速度极快，适合高频备份。</p>
                        </div>
                        <button id="btn-create-snapshot" class="settings-btn settings-btn--primary"><i class="fas fa-camera"></i> 创建快照</button>
                    </div>
                    
                    <div class="settings-snapshot-list">
                        ${snapshots.length === 0
                            ? `<div class="settings-empty settings-empty--mini" style="background:var(--st-bg-secondary);">暂无快照</div>` 
                            : snapshots.map(s => `<div class="settings-list-item snapshot-item" style="cursor:default;">
                                    <div class="settings-list-item__icon">📦</div>
                                    <div class="settings-list-item__info">
                                        <p class="settings-list-item__title">${s.displayName}</p>
                                        <p class="settings-list-item__desc">${s.name}</p>
                                    </div>
                                    <div class="settings-snapshot-actions" style="display:flex; gap:8px;">
                                        <button class="settings-btn settings-btn--sm settings-btn--secondary btn-restore-snap" data-name="${s.name}">恢复</button>
                                        <button class="settings-btn settings-btn--sm settings-btn--danger btn-del-snap" data-name="${s.name}"><i class="fas fa-trash"></i></button>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>

                <!-- 数据迁移 (JSON) -->
                <div class="settings-section" style="border-top: 1px solid var(--st-border-color); padding-top: 20px;">
                    <h3 class="settings-section__title">文件迁移 (JSON)</h3>
                    <p class="settings-page__description" style="margin-bottom: 15px;">
                        细粒度地导入/导出系统配置或特定的文档工作区。生成的 JSON 文件可用于迁移或备份。
                    </p>
                    <div class="settings-storage-actions">
                        <div class="settings-action-card">
                            <div class="settings-action-card__icon">📤</div>
                            <h3>自定义导出</h3>
                            <button id="btn-export-mixed" class="settings-btn settings-btn--primary">选择数据...</button>
                        </div>
                        <div class="settings-action-card">
                            <div class="settings-action-card__icon">📥</div>
                            <h3>恢复/导入</h3>
                            <button id="btn-import-mixed" class="settings-btn settings-btn--primary">选择文件...</button>
                        </div>
                    </div>
                </div>

                <!-- 危险区 -->
                <div class="settings-section" style="margin-top: 40px; border-top: 1px solid var(--st-border-color); padding-top: 20px;">
                    <h3 class="settings-section__title" style="color: var(--st-color-danger);">危险操作</h3>
                    <div class="settings-storage-actions">
                        <div class="settings-action-card settings-action-card--danger">
                            <div class="settings-action-card__icon">💣</div>
                            <h3>工厂重置</h3>
                            <p style="font-size:0.8em; color:#666; margin-bottom:10px;">抹除所有数据并重置为初始状态</p>
                            <button id="btn-reset" class="settings-btn settings-btn--danger">清空所有数据</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        this.bindEvents();
    }

    private bindEvents() {
        this.clearListeners();
        
        // JSON Actions
        this.bindButton('#btn-export-mixed', () => this.openExportModal());
        this.bindButton('#btn-import-mixed', () => this.triggerImportFlow());
        this.bindButton('#btn-reset', () => this.resetApp());

        // Snapshot Actions
        this.bindButton('#btn-create-snapshot', () => this.createSnapshot());

        // Snapshot List Actions
        const list = this.container.querySelector('.settings-snapshot-list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const target = e.target as HTMLElement;
                const restoreBtn = target.closest('.btn-restore-snap') as HTMLElement;
                const delBtn = target.closest('.btn-del-snap') as HTMLElement;

                if (restoreBtn) this.restoreSnapshot(restoreBtn.dataset.name!);
                if (delBtn) this.deleteSnapshot(delBtn.dataset.name!);
            });
        }
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    // --- Snapshot Logic ---

    private async createSnapshot() {
        const btn = this.container.querySelector('#btn-create-snapshot') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '创建中...';
        try {
            await this.service.createSnapshot();
            Toast.success('快照创建成功');
            await this.loadSnapshots();
        } catch (e) {
            Toast.error('创建失败');
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-camera"></i> 创建快照';
        }
    }

    private restoreSnapshot(name: string) {
        Modal.confirm(
            '确认恢复', 
            '<b>警告：此操作将覆盖当前所有数据！</b><br>系统将回滚到快照点的状态。建议先创建一个当前状态的快照。',
            async () => {
                try {
                    Toast.info('正在恢复...');
                    await this.service.restoreSnapshot(name);
                    Toast.success('恢复成功，正在刷新...');
                    setTimeout(() => window.location.reload(), 1000);
                } catch (e) {
                    Toast.error('恢复失败');
                    console.error(e);
                }
            }
        );
    }

    private async deleteSnapshot(name: string) {
        if (!confirm('确定删除此快照吗？')) return;
        try {
            await this.service.deleteSnapshot(name);
            Toast.success('已删除');
            await this.loadSnapshots();
        } catch (e) {
            Toast.error('删除失败');
        }
    }

    // --- JSON Export/Import Logic (Existing) ---

    private openExportModal() {
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
                    <div style="display:flex; flex-direction:column;">
                        <span>📂 ${ws.name}</span>
                        <small style="color:#999; font-size:0.8em;">${ws.description || '用户工作区'}</small>
                    </div>
                </label>
            `).join('')
            : `<div style="padding:10px; color:#999; font-style:italic;">无可用工作区</div>`;

        const content = `
            <div class="settings-export-modal-content" style="padding: 0 10px;">
                <div style="margin-bottom: 20px;">
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color); padding-bottom:5px;">⚙️ 系统配置</h4>
                    <div class="settings-checklist-grid">${settingsHtml}</div>
                </div>
                <div>
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color); padding-bottom:5px;">📚 文档工作区</h4>
                    <div class="settings-checklist-grid">${workspacesHtml}</div>
                </div>
                <div style="margin-top:15px; text-align:right;">
                    <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = true)">全选</small>
                    <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = false)">全不选</small>
                </div>
            </div>
            <style>
                .settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .settings-checkbox-row { display: flex; align-items: center; gap: 8px; padding: 5px; cursor: pointer; border-radius: 4px; }
                .settings-checkbox-row:hover { background: var(--st-bg-tertiary); }
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
                    this.downloadJson(data, `mindos-backup-${date}.json`);
                    Toast.success(`导出完成: ${selectedSettings.length} 项配置, ${selectedModules.length} 个工作区`);
                } catch (e) {
                    console.error(e);
                    Toast.error('导出失败');
                }
                return true;
            }
        }).show();
    }

    // --- Import UI Logic ---

    private triggerImportFlow() {
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
                    Toast.error('无法解析 JSON 文件');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    private showImportSelectionModal(json: any) {
        const availableSettings = this.service.getAvailableSettingsKeys().filter(k => {
            return (json.settings && Array.isArray(json.settings[k])) || Array.isArray(json[k]);
        });
        let availableModules: any[] = [];
        if (json.modules && Array.isArray(json.modules)) {
            availableModules = json.modules;
        }

        if (availableSettings.length === 0 && availableModules.length === 0) {
            Toast.error('文件中未发现可识别的备份数据');
            return;
        }

        const settingsHtml = availableSettings.map(key => {
            const count = (json.settings?.[key] || json[key])?.length || 0;
            return `
            <label class="settings-checkbox-row">
                <input type="checkbox" name="import-settings" value="${key}" checked>
                <div style="flex:1; display:flex; justify-content:space-between;">
                    <span>${SETTINGS_LABELS[key] || key}</span>
                    <span class="settings-badge">${count}</span>
                </div>
            </label>`;
        }).join('');

        const modulesHtml = availableModules.map(mod => {
            const name = mod.module?.name || 'Unknown';
            if (['__vfs_meta__', '__config'].includes(name)) return '';
            return `
            <label class="settings-checkbox-row">
                <input type="checkbox" name="import-modules" value="${name}">
                <div style="flex:1; display:flex; justify-content:space-between;">
                    <span>📂 ${name}</span>
                    <span class="settings-badge settings-badge--warning" style="font-size:0.7em; background:#fee2e2; color:#991b1b;">覆盖</span>
                </div>
            </label>`;
        }).join('');

        const content = `
            <div class="settings-export-modal-content" style="padding: 0 10px;">
                <p style="color:var(--st-text-secondary); margin-bottom:15px;">检测到以下数据，请选择要恢复的项目：</p>
                
                ${settingsHtml ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color);">⚙️ 配置数据 (Settings)</h4>
                    <div class="settings-checklist-grid">${settingsHtml}</div>
                </div>` : ''}

                ${modulesHtml ? `
                <div>
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color);">📚 工作区 (Workspaces) <small style="color:var(--st-color-danger); font-weight:normal;">(同名工作区将被覆盖)</small></h4>
                    <div class="settings-checklist-grid">${modulesHtml}</div>
                </div>` : ''}
            </div>
            <style>.settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }</style>
        `;

        new Modal('导入数据', content, {
            confirmText: '执行导入',
            type: 'danger',
            onConfirm: async () => {
                const sInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-settings"]:checked');
                const mInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-modules"]:checked');
                
                const keysToImport = Array.from(sInputs).map(i => i.value as keyof SettingsState);
                const modulesToImport = Array.from(mInputs).map(i => i.value);

                if (keysToImport.length === 0 && modulesToImport.length === 0) return true;

                try {
                    await this.service.importMixedData(json, keysToImport, modulesToImport);
                    Toast.success('导入成功，应用正在刷新...');
                    setTimeout(() => window.location.reload(), 1500);
                } catch (e) {
                    console.error(e);
                    Toast.error('导入错误');
                }
                return true;
            }
        }).show();
    }

    // --- Helper ---

    private resetApp() {
        Modal.confirm('⚠️ 恢复出厂设置', '此操作将永久删除所有数据。', async () => {
            try {
                await this.service.factoryReset();
                Toast.success('数据已清除，正在重启...');
                setTimeout(() => window.location.reload(), 1000);
            } catch (e) {
                console.error(e);
                Toast.error('重置失败');
            }
        });
    }

    private downloadJson(data: object | string, filename: string) {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}
