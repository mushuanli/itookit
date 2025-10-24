// 文件: demo/settings.js

/**
 * @file @demo/settings.js
 * @description 演示如何初始化 SettingsWorkspace 并集成自定义 Widget。
 *
 * [V3 核心重构]
 * - **遵循应用生命周期**: 严格遵循 "先初始化 ConfigManager -> 等待 app:ready -> 再初始化 Workspace" 的流程。
 * - **依赖注入**: createSettingsWorkspace 现在通过构造函数接收所有必需的依赖。
 */

// [核心重构] 必须先导入并初始化 ConfigManager
import { getConfigManager } from '../configManager/index.js';
// 导入 SettingsWorkspace 的工厂函数
import { createSettingsWorkspace } from '../workspace/settings/index.js';
// 导入 Widget 接口，用于类型规范
import { ISettingsWidget } from '../common/interfaces/ISettingsWidget.js';

// --- 自定义 Widget 定义 (保持不变) ---
export class AppearanceWidget extends ISettingsWidget {
    constructor() {
        super();
        this._isDirty = false; // [修改] 添加内部脏状态
        this.container = null;
    }

    get id() { return 'appearance-settings'; }
    get label() { return '外观'; }
    get iconHTML() { return '🎨'; }
    get description() { return '自定义应用的外观和感觉。'; }
    get isDirty() { return this._isDirty; }

    async mount(container) {
        this.container = container;
        this._isDirty = false; // [修改] 挂载时重置状态
        container.innerHTML = `
            <div class="settings-widget">
                <h2>🎨 ${this.label}</h2>
                <p>${this.description}</p>
                <fieldset>
                    <legend>主题</legend>
                    <label><input type="radio" name="theme" value="light" checked> 明亮</label>
                    <label><input type="radio" name="theme" value="dark"> 暗黑</label>
                    <label><input type="radio" name="theme" value="system"> 跟随系统</label>
                </fieldset>
                <div class="form-actions" style="margin-top: 20px;">
                    <button id="save-appearance-btn" class="settings-btn">保存设置</button>
                </div>
            </div>
        `;

        // [修改] 事件监听现在会更新脏状态
        container.querySelector('fieldset').addEventListener('change', (e) => {
            console.log(`主题选择已更改为: ${e.target.value}`);
            this._isDirty = true;
            // 更新按钮状态以提供视觉反馈
            this.updateSaveButtonState();
        });
        
        // [修改] 为保存按钮添加事件监听
        container.querySelector('#save-appearance-btn').addEventListener('click', () => {
            const selectedTheme = container.querySelector('input[name="theme"]:checked').value;
            console.log(`外观设置已保存! 主题是: ${selectedTheme}`);
            alert(`外观设置已保存! 主题是: ${selectedTheme}`);
            this._isDirty = false; // 重置脏状态
            this.updateSaveButtonState();
        });

        this.updateSaveButtonState();
    }

    async unmount() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.container = null;
    }

    // [修改] 新增一个辅助方法来更新UI
    updateSaveButtonState() {
        if (this.container) {
            const saveBtn = this.container.querySelector('#save-appearance-btn');
            if (saveBtn) {
                saveBtn.textContent = this._isDirty ? '保存设置 *' : '保存设置';
                saveBtn.disabled = !this._isDirty;
            }
        }
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 正在初始化应用...");
    
    try {
        // 1. 获取并初始化 ConfigManager
        const configManager = getConfigManager();
        await configManager.init();
        console.log("✅ ConfigManager 已就绪");
        
        // 2. 创建工作区
        const workspace = await createSettingsWorkspace({
            configManager: configManager,
            namespace: 'settings-workspace-demo',
            sidebarContainer: document.getElementById('sidebar-container'),
            settingsContainer: document.getElementById('settings-container'),
            widgets: [AppearanceWidget]
        });

        console.log("✅ Settings Workspace 启动成功！");
        window.settingsWorkspace = workspace;
        
    } catch (error) {
        console.error("❌ 初始化失败:", error);
        document.body.innerHTML = `
            <div class="error-message">
                <h3>❌ 初始化失败</h3>
                <p><strong>错误:</strong> ${error.message}</p>
            </div>
        `;
    }
});
