// @file #workspace/settings/components/GeneralSettingsWidget.css

import { ISettingsWidget } from '../../../common/interfaces/ISettingsWidget.js';
import { ConfigManager } from '../../../config/ConfigManager.js';
import './GeneralSettingsWidget.css';

export class GeneralSettingsWidget extends ISettingsWidget {
    constructor() {
        super();
        this.container = null;
        this.configManager = ConfigManager.getInstance();
        this._boundHandleExport = this._handleExport.bind(this);
        this._boundHandleImport = this._handleImport.bind(this);
    }

    // --- ISettingsWidget 接口实现 ---

    get id() { return 'general-settings'; }
    get label() { return '通用设置'; }
    get iconHTML() { return '⚙️'; }
    get description() { return '导入或导出整个应用程序的数据。'; }

    // --- 生命周期方法 ---

    async mount(container) {
        this.container = container;
        this._renderShell();
        this._attachEventListeners();
    }

    async unmount() {
        this._removeEventListeners();
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.container = null;
    }

    async destroy() {
        await this.unmount();
    }

    // --- 私有方法 ---

    _renderShell() {
        this.container.innerHTML = `
            <div class="general-settings-widget">
                <h3>数据库同步</h3>
                <p>将整个应用程序数据库导出为单个 JSON 文件，或从文件中导入以在另一台计算机上恢复您的全部工作区数据。这对于备份和迁移非常有用。</p>
                <div class="sync-actions">
                    <button id="import-data-btn" class="settings-btn">导入数据</button>
                    <button id="export-data-btn" class="settings-btn settings-btn-primary">导出数据</button>
                </div>
            </div>
        `;
    }

    _attachEventListeners() {
        this.container.querySelector('#import-data-btn').addEventListener('click', this._boundHandleImport);
        this.container.querySelector('#export-data-btn').addEventListener('click', this._boundHandleExport);
    }

    _removeEventListeners() {
        const importBtn = this.container?.querySelector('#import-data-btn');
        const exportBtn = this.container?.querySelector('#export-data-btn');
        if (importBtn) importBtn.removeEventListener('click', this._boundHandleImport);
        if (exportBtn) exportBtn.removeEventListener('click', this._boundHandleExport);
    }

    async _handleExport() {
        try {
            const allData = {};
            // 从持久化适配器获取应用数据的前缀
            const prefix = this.configManager.persistenceAdapter.prefix || '';

            // 遍历 localStorage 中的所有条目
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                // 只导出带有应用前缀的数据
                if (key.startsWith(prefix)) {
                    const rawKey = key.substring(prefix.length);
                    const value = JSON.parse(localStorage.getItem(key));
                    allData[rawKey] = value;
                }
            }

            if (Object.keys(allData).length === 0) {
                alert('没有找到可导出的数据。');
                return;
            }

            const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            a.href = url;
            a.download = `workspace_backup_${timestamp}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error('导出数据失败:', error);
            alert(`导出数据失败: ${error.message}`);
        }
    }

    _handleImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!confirm('【警告】导入数据将完全覆盖您当前的所有本地数据（包括标签、LLM配置和所有会话），此操作不可撤销。\n\n您确定要继续吗？')) {
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const dataToImport = JSON.parse(event.target.result);
                    const prefix = this.configManager.persistenceAdapter.prefix || '';

                    // 1. 清除所有现有的应用数据
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.startsWith(prefix)) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(key => localStorage.removeItem(key));

                    // 2. 导入新数据
                    for (const rawKey in dataToImport) {
                        if (Object.hasOwnProperty.call(dataToImport, rawKey)) {
                            const fullKey = `${prefix}${rawKey}`;
                            const value = JSON.stringify(dataToImport[rawKey]);
                            localStorage.setItem(fullKey, value);
                        }
                    }

                    alert('数据导入成功！应用程序将重新加载以应用更改。');
                    setTimeout(() => window.location.reload(), 500);

                } catch (error) {
                    console.error('导入数据失败:', error);
                    alert(`导入数据失败: ${error.message}。\n\n请确保文件是之前导出的有效备份文件。`);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
}
