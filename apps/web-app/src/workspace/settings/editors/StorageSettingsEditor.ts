// @file: app/workspace/settings/editors/StorageSettingsEditor.ts
import { BaseSettingsEditor } from './BaseSettingsEditor';
import { Modal, Toast } from '../components/UIComponents';

export class StorageSettingsEditor extends BaseSettingsEditor {
    private storageInfo: any = null;

    async init(container: HTMLElement) {
        await super.init(container);
        await this.loadStorageInfo();
    }

    async loadStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                this.storageInfo = await navigator.storage.estimate();
                this.render();
            } catch (e) { console.error(e); }
        }
    }

    render() {
        const usage = this.storageInfo?.usage || 0;
        const quota = this.storageInfo?.quota || 1;
        const percent = ((usage / quota) * 100).toFixed(1);
        const usageMB = (usage / 1024 / 1024).toFixed(2);

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <h2 class="settings-page__title">存储管理</h2>
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
                                <span class="settings-detail-item__label">已使用</span>
                                <span class="settings-detail-item__value">${usageMB} MB</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-storage-actions">
                    <div class="settings-action-card">
                        <div class="settings-action-card__icon">📤</div>
                        <h3>导出配置</h3>
                        <button id="btn-export" class="settings-btn settings-btn--primary">导出 JSON</button>
                    </div>
                    <div class="settings-action-card">
                        <div class="settings-action-card__icon">📥</div>
                        <h3>导入配置</h3>
                        <button id="btn-import" class="settings-btn settings-btn--primary">导入 JSON</button>
                    </div>
                    <div class="settings-action-card settings-action-card--danger">
                        <div class="settings-action-card__icon">🧹</div>
                        <h3>重置应用</h3>
                        <button id="btn-reset" class="settings-btn settings-btn--danger">清空所有数据</button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    private bindEvents() {
        this.clearListeners();
        
        this.bindButton('#btn-export', () => this.exportConfig());
        this.bindButton('#btn-import', () => this.importConfig());
        this.bindButton('#btn-reset', () => this.resetApp());
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    private exportConfig() {
        const data = JSON.stringify(this.service.exportAll(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'settings-backup.json';
        a.click();
    }

    private importConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e: any) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev: any) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    await this.service.importAll(data);
                    Toast.success('Imported successfully');
                } catch (err) {
                    Toast.error('Invalid JSON');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    private resetApp() {
        Modal.confirm('DANGER', '此操作将清空所有设置数据！确定吗？', async () => {
            await this.service.clearAll();
            Toast.success('App reset');
            window.location.reload();
        });
    }
}
