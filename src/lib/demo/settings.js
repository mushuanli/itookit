/**
 * @file @demo/settings.js
 * This is the main entry point for the demo application.
 * It demonstrates how to initialize the SettingsWorkspace with both default
 * and custom widgets, including dirty state tracking.
 */

// [核心重构] 必须先导入并初始化 ConfigManager
import { ConfigManager } from '../config/ConfigManager.js';
// 导入 SettingsWorkspace 的工厂函数
import { createSettingsWorkspace } from '../workspace/settings/index.js';
// 导入 Widget 接口，用于类型规范
import { ISettingsWidget } from '../common/interfaces/ISettingsWidget.js';


export class AppearanceWidget extends ISettingsWidget {
    constructor() {
        super();
        this._isDirty = false; // [修改] 添加内部脏状态
        this.container = null;
    }

    get id() { return 'appearance-settings'; }
    get label() { return '外观'; }
    get description() { return '自定义应用的外观和感觉。'; }

    // [修改] 实现 isDirty getter
    get isDirty() {
        return this._isDirty;
    }

    async mount(container) {
        this.container = container;
        this._isDirty = false; // [修改] 挂载时重置状态
        container.innerHTML = `
            <div class="settings-widget">
                <h2>🎨 ${this.label}</h2>
                <p>${this.description}</p>
                <fieldset>
                    <legend>主题</legend>
                    <label>
                        <input type="radio" name="theme" value="light" checked> 明亮
                    </label>
                    <label>
                        <input type="radio" name="theme" value="dark"> 暗黑
                    </label>
                    <label>
                        <input type="radio" name="theme" value="system"> 跟随系统
                    </label>
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
        // 在卸载前检查脏状态，这是 SettingsWorkspace 的职责，这里仅清理 DOM
        if (this.container) this.container.innerHTML = '';
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


document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已加载。正在初始化 Settings Workspace...");

    // --- [核心修复] 步骤 1: 初始化应用的核心服务 ConfigManager ---
    // 在一个真实的应用中，这应该在应用的最高层入口处完成。
    const configManager = ConfigManager.getInstance({
        // 提供一个前缀以避免 LocalStorage 键冲突
        adapterOptions: { prefix: 'settings_demo_app_' }
    });

    // --- [核心修复] 步骤 2: 使用新的 API 创建 SettingsWorkspace ---
    // 我们现在注入 configManager 实例，而不是手动配置 storage。
    const workspace = createSettingsWorkspace({
        sidebarContainer: document.getElementById('sidebar-container'),
        settingsContainer: document.getElementById('settings-container'),
        
        // 传入已初始化的 ConfigManager 实例
        configManager: configManager,
        // 命名空间仍然需要，用于隔离侧边栏本身的状态（例如最后选中的项目）
        namespace: 'settings-workspace-demo',

        // --- 演示如何添加自定义 Widget ---
        // SettingsWorkspace 会自动将默认的 LLMSettingsWidget 添加到此列表的开头，
        // 因为我们提供的 AppearanceWidget 的 ID 与之不同。
        // 因此，最终的侧边栏将显示 "AI Settings" 和 "外观" 两个选项。
        // 如果您完全不提供 'widgets' 键，侧边栏将只显示 "AI Settings"。
        widgets: [
            AppearanceWidget
        ]
    });

    // 启动工作区
    workspace.start().then(() => {
        console.log("Settings Workspace 启动成功!");
        // 现在可以测试：
        // 1. 在 "外观" 设置中更改主题，不要保存。
        // 2. 点击侧边栏切换到 "AI Settings"。
        // 3. 浏览器应会弹出一个确认框，询问是否放弃更改。
    });
});
