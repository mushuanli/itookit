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
                        <h3>系统备份</h3>
                        <p style="font-size:0.8em; color:#666; margin-bottom:10px;">导出所有文档和设置</p>
                        <button id="btn-export" class="settings-btn settings-btn--primary">导出备份文件</button>
                    </div>
                    <div class="settings-action-card">
                        <div class="settings-action-card__icon">📥</div>
                        <h3>恢复备份</h3>
                        <p style="font-size:0.8em; color:#666; margin-bottom:10px;">从备份文件恢复所有数据</p>
                        <button id="btn-import" class="settings-btn settings-btn--primary">导入备份文件</button>
                    </div>
                    <div class="settings-action-card settings-action-card--danger">
                        <div class="settings-action-card__icon">🧹</div>
                        <h3>恢复出厂设置</h3>
                        <p style="font-size:0.8em; color:#666; margin-bottom:10px;">清空所有数据并重置</p>
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

    private async exportConfig() {
        try {
            // [修改] 调用全量备份
            const data = await this.service.createFullBackup();
            
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `mindos-backup-${date}.json`;
            a.click();
            
            Toast.success('系统备份已生成');
        } catch (e) {
            console.error(e);
            Toast.error('导出失败');
        }
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
                    const json = ev.target.result;
                    
                    // 确认提示
                    Modal.confirm(
                        '恢复备份', 
                        '这将覆盖当前所有数据（包括所有文档和设置），且无法撤销！确定要继续吗？',
                        async () => {
                            try {
                                // [修改] 调用全量恢复
                                await this.service.restoreFullBackup(json);
                                Toast.success('恢复成功，正在刷新...');
                                setTimeout(() => window.location.reload(), 1500);
                            } catch (err) {
                                console.error(err);
                                Toast.error('恢复失败: 数据格式错误');
                            }
                        }
                    );

                } catch (err) {
                    Toast.error('读取文件失败');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    private resetApp() {
        Modal.confirm(
            '⚠️ 恢复出厂设置', 
            '此操作将永久删除所有工作区、文档和设置数据。应用将重置为初始状态。此操作不可逆！', 
            async () => {
                try {
                    // [修改] 调用工厂重置
                    await this.service.factoryReset();
                    Toast.success('数据已清除，正在重启...');
                    setTimeout(() => window.location.reload(), 1000);
                } catch (e) {
                    console.error(e);
                    Toast.error('重置失败');
                }
            }
        );
    }
}
