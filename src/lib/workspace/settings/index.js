// 文件: #workspace/settings/index.js (V4 - 完整重构版)

/**
 * 文件: #workspace/settings/index.js
 * @description
 * 一个用于编排设置页侧边栏和内容区域的协调器。
 * 它现在默认包含 LLMSettingsWidget 和 TagsSettingsWidget 以提供开箱即用的体验，
 * 同时保持完全的可定制性。
 *
 * [V2 修复] - 重构了依赖管理方式，不再自行处理持久化，而是
 *             像 MDxWorkspace 一样，接收一个已初始化的 ConfigManager 实例。
 * [V3 修改] - 增加了 TagsSettingsWidget 作为默认组件，并设计了可扩展的默认组件加载机制。
 * [V4 核心特性]
 * - 智能Widget合并（默认 + 自定义）
 * - 正确的命名空间管理
 * - 完善的生命周期管理
 */

import { createSessionUI } from '../../sidebar/index.js';
import { testLLMConnection } from '../../llm/core/index.js';
import { LLMSettingsWidget } from '../../llm/settings/index.js';
import { TagsSettingsWidget } from './components/TagsSettingsWidget.js';
import { GeneralSettingsWidget } from './components/GeneralSettingsWidget.js';
import { isClass } from '../../common/utils/utils.js';

/**
 * @typedef {import('../../common/interfaces/ISettingsWidget.js').ISettingsWidget} ISettingsWidget
 * @typedef {new (...args: any[]) => ISettingsWidget} SettingsWidgetClass
 */

/**
 * @typedef {object} SettingsWorkspaceOptions
 * @property {HTMLElement} sidebarContainer - [必需] 侧边栏容器
 * @property {HTMLElement} settingsContainer - [必需] 设置内容容器
 * @property {import('../../configManager/index.js').ConfigManager} configManager - [必需] ConfigManager 实例
 * @property {string} namespace - [必需] 工作区唯一命名空间
 * @property {(SettingsWidgetClass | ISettingsWidget)[]} [widgets] - 自定义 Widget 列表
 *   **[重要]** 此工作区默认会自动包含 `GeneralSettingsWidget`、`TagsSettingsWidget` 和 `LLMSettingsWidget`。
 *   如果用户提供的 `widgets` 数组中不包含具有相应 ID 的 Widget，
 *   默认的 Widgets 将被自动添加到列表的开头。
 * @property {object} [widgetOptions] - (可选) 一个对象，包含要传递给每个 Widget 构造函数的依赖项或设置（如果它们作为类提供）。
 */

export class SettingsWorkspace {
    /**
     * @param {SettingsWorkspaceOptions} options
     */
    constructor(options) {
        this._validateOptions(options);

        // 核心依赖
        this.configManager = options.configManager;
        this.namespace = options.namespace;

        // 智能合并 Widgets
        this.options = this._mergeWidgets(options, [
            GeneralSettingsWidget,
            TagsSettingsWidget,
            LLMSettingsWidget
        ]);

        // 组件实例
        this.sidebar = null;
        /** @private @type {ISettingsWidget | null} */
        this.activeWidget = null;
        /** @private @type {ISettingsWidget[]} */
        this.widgets = [];

        // 内部状态
        this._subscriptions = [];
        this._boundHandleBeforeUnload = this._handleBeforeUnload.bind(this);
    }

    // =========================================================================
    // 公共 API
    // =========================================================================

    /**
     * 检查是否有未保存的更改
     * @returns {boolean}
     */
    get isDirty() {
        return this.activeWidget?.isDirty || false;
    }

    /**
     * 初始化并启动工作区
     * @returns {Promise<void>}
     */
    async start() {
        console.log(`[SettingsWorkspace] 正在启动工作区: ${this.namespace}`);

        // 1. 实例化所有 Widgets
        this.widgets = this.options.widgets.map(WidgetOrInstance => {
            // 如果它是一个类（使用工具函数检查），则实例化它。
            if (isClass(WidgetOrInstance)) {
                return new WidgetOrInstance(this.options.widgetOptions || {});
            }
            // 否则，它已经是一个实例，所以直接使用它。
            return WidgetOrInstance;
        });

        // 2. 构建侧边栏项目列表
        const sidebarItems = this.widgets.map(widget => ({
            id: widget.id,
            type: 'item',
            version: "1.0",
            metadata: {
                title: widget.label,
                iconHTML: widget.iconHTML,
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                parentId: null,
            },
            content: {
                summary: widget.description || '',
            },
        }));

        // 3. 创建侧边栏
        this.sidebar = createSessionUI({
            sessionListContainer: this.options.sidebarContainer,
            // storageKey 选项已被废弃，现在由 namespace 统一管理
            // 直接提供项目，绕过侧边栏持久化自己列表的需求。
            initialState: { items: sidebarItems },
            readOnly: true,
            title: '设置',
            searchPlaceholder: '搜索设置...'
        }, this.configManager, this.namespace);

        // 4. 连接事件
        this._connectEvents();

        // 5. 监听窗口关闭
        window.addEventListener('beforeunload', this._boundHandleBeforeUnload);

        // 6. 启动侧边栏（会自动选择第一项）
        await this.sidebar.start();

        console.log(`[SettingsWorkspace] ✅ 工作区启动成功`);
    }

    /**
     * 销毁工作区
     */
    async destroy() {
        console.log('[SettingsWorkspace] 正在销毁工作区...');

        // 1. 移除窗口监听
        window.removeEventListener('beforeunload', this._boundHandleBeforeUnload);

        // 2. 取消所有订阅
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        // 3. 销毁组件
        this.sidebar?.destroy();
        this.activeWidget?.destroy();

        // 4. 清理 DOM
        if (this.options.sidebarContainer) {
            this.options.sidebarContainer.innerHTML = '';
        }
        if (this.options.settingsContainer) {
            this.options.settingsContainer.innerHTML = '';
        }

        // 5. 清理引用
        this.sidebar = null;
        this.activeWidget = null;
        this.widgets = [];

        console.log('[SettingsWorkspace] ✅ 工作区已销毁');
    }

    // =========================================================================
    // 私有方法
    // =========================================================================

    /**
     * 验证构造函数选项
     * @private
     */
    _validateOptions(options) {
        if (!options.sidebarContainer || !options.settingsContainer) {
            throw new Error('[SettingsWorkspace] 需要 sidebarContainer 和 settingsContainer');
        }
        if (!options.configManager || typeof options.configManager.init !== 'function') {
            throw new Error('[SettingsWorkspace] 需要有效的 configManager 实例');
        }
        if (!options.namespace) {
            throw new Error('[SettingsWorkspace] 需要唯一的 namespace 字符串');
        }
        if (options.widgets && !Array.isArray(options.widgets)) {
            throw new Error('[SettingsWorkspace] widgets 选项必须是数组');
        }
    }

    /**
     * 智能合并默认和自定义 Widgets
     * @private
     */
    _mergeWidgets(options, defaultClasses) {
        const customWidgets = options.widgets || [];
        
        // 获取所有已提供的 Widget ID
        const providedIds = new Set(
            customWidgets
                .map(w => {
                    if (isClass(w)) {
                        try {
                            return new w().id;
                        } catch (e) {
                            console.warn('[SettingsWorkspace] 无法从 Widget 类获取 ID', w);
                            return null;
                        }
                    }
                    return w?.id;
                })
                .filter(Boolean)
        );

        // 从自定义 Widgets 开始
        let finalWidgets = [...customWidgets];

        // 倒序添加默认组件到列表开头（这样最终顺序与 defaultClasses 一致）
        defaultClasses.reverse().forEach(WidgetClass => {
            try {
                const defaultId = new WidgetClass().id;
                if (!providedIds.has(defaultId)) {
                    finalWidgets.unshift(WidgetClass);
                }
            } catch (e) {
                console.warn('[SettingsWorkspace] 跳过默认 Widget', WidgetClass);
            }
        });

        return {
            ...options,
            widgets: finalWidgets,
            widgetOptions: {
                ...(options.widgetOptions || {}),
                onTestLLMConnection: testLLMConnection
            }
        };
    }

    /**
     * 连接侧边栏事件
     * @private
     */
    _connectEvents() {
        this._subscriptions.push(
            this.sidebar.on('sessionSelected', ({ item }) => {
                if (item) {
                    this._mountWidgetById(item.id);
                }
            })
        );
    }

    /**
     * 挂载指定的 Widget
     * @private
     */
    async _mountWidgetById(widgetId) {
        if (!widgetId || this.activeWidget?.id === widgetId) {
            return; // 已经是当前 Widget
        }

        // 检查未保存的更改
        if (this.isDirty) {
            const confirmed = confirm(
                '您有未保存的更改，确定要切换吗？此操作将丢失您的更改。'
            );
            if (!confirmed) {
                // 用户取消，需要恢复侧边栏选择
                // TODO: 实现侧边栏选择恢复逻辑
                return;
            }
        }

        // 查找目标 Widget
        const widgetToMount = this.widgets.find(w => w.id === widgetId);
        if (!widgetToMount) {
            console.error(`[SettingsWorkspace] 未找到 Widget: ${widgetId}`);
            this.options.settingsContainer.innerHTML = `
                <p style="color: red;">错误: 无法加载 Widget "${widgetId}"</p>
            `;
            return;
        }

        // 卸载当前 Widget
        if (this.activeWidget && typeof this.activeWidget.unmount === 'function') {
            await this.activeWidget.unmount();
        }

        // 清空容器并挂载新 Widget
        this.options.settingsContainer.innerHTML = '';
        this.activeWidget = widgetToMount;
        
        try {
            await this.activeWidget.mount(
                this.options.settingsContainer, 
                this.options.widgetOptions
            );
            console.log(`[SettingsWorkspace] ✅ Widget 已挂载: ${widgetId}`);
        } catch (error) {
            console.error(`[SettingsWorkspace] ❌ 挂载 Widget 失败:`, error);
            this.options.settingsContainer.innerHTML = `
                <p style="color: red;">错误: 挂载 Widget 失败</p>
            `;
        }
    }

    /**
     * 处理窗口关闭前事件
     * @private
     * @param {Event} event
     * @description 处理窗口/标签页关闭前的事件，以防止数据丢失。
     */
    _handleBeforeUnload(event) {
        if (this.isDirty) {
            const message = '您有未保存的更改，确定要离开吗？';
            event.returnValue = message;
            return message;
        }
    }
}

/**
 * 工厂函数：创建并初始化 SettingsWorkspace
 * @param {SettingsWorkspaceOptions} options
 * @returns {Promise<SettingsWorkspace>} 已初始化的工作区实例
 */
export async function createSettingsWorkspace(options) {
    const workspace = new SettingsWorkspace(options);
    await workspace.start();
    return workspace;
}