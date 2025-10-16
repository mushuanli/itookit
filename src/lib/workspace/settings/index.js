/**
 * @file #workspace/settings/index.js
 * @description
 * 一个用于编排设置页侧边栏和内容区域的协调器。
 * 它现在默认包含 LLMSettingsWidget 和 TagsSettingsWidget 以提供开箱即用的体验，
 * 同时保持完全的可定制性。
 *
 * [V2 修复] - 重构了依赖管理方式，不再自行处理持久化，而是
 *             像 MDxWorkspace 一样，接收一个已初始化的 ConfigManager 实例。
 * [V3 修改] - 增加了 TagsSettingsWidget 作为默认组件，并设计了可扩展的默认组件加载机制。
 * [V4 新增] - 增加了 GeneralSettingsWidget 用于数据同步。
 */

import { createSessionUI } from '../../sidebar/index.js';
import { testLLMConnection } from '../../llm/core/index.js';
import { LLMSettingsWidget } from '../../llm/settings/index.js';
import { TagsSettingsWidget } from './components/TagsSettingsWidget.js';
import { GeneralSettingsWidget } from './components/GeneralSettingsWidget.js'; // +++ 新增: 导入通用设置 Widget
import { isClass } from '../../common/utils/utils.js';

/**
 * @typedef {import('../../common/interfaces/ISettingsWidget.js').ISettingsWidget} ISettingsWidget
 * @typedef {new (...args: any[]) => ISettingsWidget} SettingsWidgetClass
 */

/**
 * @typedef {object} SettingsWorkspaceOptions
 * @property {HTMLElement} sidebarContainer - **必需** 用于导航侧边栏的容器。
 * @property {HTMLElement} settingsContainer - **必需** 用于主设置内容的容器。
 * @property {import('../../config/ConfigManager.js').ConfigManager} configManager - [新] **必需** 一个已初始化的 ConfigManager 实例。
 * @property {string} namespace - [新] **必需** 此工作区实例的唯一命名空间，用于隔离侧边栏的状态。
 * @property {(SettingsWidgetClass | ISettingsWidget)[]} [widgets] - (可选) 一个包含 Widget 类或实例的数组。
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
        this._validateOptions(options); // 先验证传入的 options

        // --- [核心修改] 智能 Widget 合并逻辑 ---
        // 设计目标：确保默认组件存在，允许用户覆盖，并保持可扩展性。

        // 1. 定义默认组件，顺序决定了它们在侧边栏中的显示顺序。
        const defaultWidgetClasses = [GeneralSettingsWidget, TagsSettingsWidget, LLMSettingsWidget]; // +++ 修改: 将 GeneralSettingsWidget 添加到列表开头
        const customWidgets = options.widgets || [];

        // 2. 获取用户提供的所有 widget 的 ID，用于去重检查。
        const providedWidgetIds = new Set(customWidgets.map(widget => {
            if (isClass(widget)) {
                try {
                    // 这种方式依赖于无参构造函数，对于我们的 ISettingsWidget 是安全的。
                    return new widget().id;
                } catch (e) {
                    console.warn("无法从 Widget 类中获取 ID", widget);
                    return null;
                }
            }
            return widget?.id;
        }).filter(Boolean));

        // 3. 合并列表：将用户提供的 widgets 作为基础。
        let finalWidgets = [...customWidgets];

        // 4. 倒序遍历默认组件列表，如果用户未提供，则将其添加到最终列表的 *开头*。
        //    倒序 unshift 可以确保最终列表中的顺序与 defaultWidgetClasses 中定义的顺序一致。
        defaultWidgetClasses.reverse().forEach(WidgetClass => {
            let defaultId;
            try {
                defaultId = new WidgetClass().id;
            } catch (e) {
                return; // 无法实例化则跳过
            }

            if (!providedWidgetIds.has(defaultId)) {
                finalWidgets.unshift(WidgetClass);
            }
        });
        
        // 重新组装最终的 options 对象，供类的其余部分使用。
        const finalWidgetOptions = {
            ...(options.widgetOptions || {}),
            onTestLLMConnection: testLLMConnection // 将其注入到 widgetOptions 中
        };

        this.options = { ...options, widgets: finalWidgets, widgetOptions: finalWidgetOptions };
        
        // --- [新增] 存储核心依赖 ---
        /** @private @type {import('../../config/ConfigManager.js').ConfigManager} */
        this.configManager = this.options.configManager;
         /** @private @type {string} */
        this.namespace = this.options.namespace;
        
        /** @private */
        this.sidebar = null;
        /** @private @type {ISettingsWidget | null} */
        this.activeWidget = null;
        /** @private @type {ISettingsWidget[]} */
        this.widgets = [];

        // --- [新增] 绑定 beforeunload 事件处理器 ---
        this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
    }

    /**
     * 检查是否有未保存的更改。
     * @returns {boolean}
     */
    get isDirty() {
        return this.activeWidget?.isDirty || false;
    }

    /**
     * 初始化侧边栏和 Widgets，然后渲染工作区。
     * @returns {Promise<void>}
     */
    async start() {
        // [MODIFIED] - 实例化逻辑现在可以处理类和预创建的实例。
        // 这对于允许依赖注入至关重要。
        this.widgets = this.options.widgets.map(WidgetOrInstance => {
            // 如果它是一个类（使用工具函数检查），则实例化它。
            if (isClass(WidgetOrInstance)) {
                return new WidgetOrInstance(this.options.widgetOptions || {});
            }
            // 否则，它已经是一个实例，所以直接使用它。
            return WidgetOrInstance;
        });

        const sidebarItems = this.widgets.map(widget => ({
            id: widget.id,
            type: 'item', // 将每个设置视为一个可选择的“项目”
            version: "1.0",
            metadata: {
                title: widget.label,
                iconHTML: widget.iconHTML, // +++ 传递 iconHTML 到侧边栏
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                parentId: null,
            },
            content: {
                summary: widget.description || '',
            },
        }));

        // --- [核心改进] ---
        // 1. 定义此工作区对侧边栏的默认配置。
        //    一个设置工作区的侧边栏天生就是只读的导航。
        const defaultSidebarOptions = {
            readOnly: true,
            title: '设置',
            searchPlaceholder: '搜索设置...'
        };

        // 2. 将默认配置与用户可能传入的自定义配置合并。
        //    这样用户仍然可以覆盖标题等设置，但默认行为是安全的。
        const finalSidebarOptions = {
            ...defaultSidebarOptions,
            ...(this.options.sidebarOptions || {})
        };
        
        // 3. 使用最终合并后的配置创建侧边栏。
        this.sidebar = createSessionUI({
            sessionListContainer: this.options.sidebarContainer,
            storageKey: this.namespace, // 命名空间依然需要，用于隔离侧边栏自身状态
            // 直接提供项目，绕过侧边栏持久化自己列表的需求。
            initialState: { items: sidebarItems },
            ...finalSidebarOptions // 传入合并后的配置
        }, this.configManager);

        this._connectEvents();
        
        // --- [新增] 监听窗口关闭事件 ---
        window.addEventListener('beforeunload', this._handleBeforeUnload);
        
        // 4. 启动侧边栏并默认选择第一项
        await this.sidebar.start();
    }

    /**
     * [新增] 核心挂载逻辑，被提取为一个可复用的私有方法。
     * @param {string} widgetId 要挂载的 Widget 的 ID。
     * @private
     */
    async _mountWidgetById(widgetId) {
        if (!widgetId || this.activeWidget?.id === widgetId) {
            return;
        }

        // 检查脏状态
        if (this.isDirty && !confirm('您有未保存的更改，确定要切换吗？此操作将丢失您的更改。')) {
            // 注意：这里我们需要一种方式来阻止侧边栏的视觉状态更新。
            // 这是一个更复杂的问题，暂时先只阻止内容切换。
            return;
        }

        const widgetToMount = this.widgets.find(w => w.id === widgetId);
        if (!widgetToMount) {
            console.error(`未找到 ID 为 "${widgetId}" 的设置 Widget。`);
            this.options.settingsContainer.innerHTML = `<p style="color: red;">错误: 无法加载 ID 为 "${widgetId}" 的 Widget。</p>`;
            return;
        }

        // 卸载当前活动的 Widget
        if (this.activeWidget && typeof this.activeWidget.unmount === 'function') {
            await this.activeWidget.unmount();
        }

        // 清空容器并挂载新的 Widget
        this.options.settingsContainer.innerHTML = '';
        this.activeWidget = widgetToMount;
        await this.activeWidget.mount(this.options.settingsContainer, this.options.widgetOptions);
    }

    /**
     * 将侧边栏选择事件连接到 Widget 挂载逻辑。
     * @private
     */
    _connectEvents() {
        if (!this.sidebar) return;

        // --- [核心修改] ---
        // 事件监听器现在只调用 _mountWidgetById，不再重复逻辑。
        this.sidebar.on('sessionSelected', ({ item }) => {
            if (item) {
                this._mountWidgetById(item.id);
            }
        });
    }

    /**
     * 销毁工作区及其所有组件。
     */
    destroy() {
        // --- [新增] 移除窗口关闭事件监听器 ---
        window.removeEventListener('beforeunload', this._handleBeforeUnload);

        this.sidebar?.destroy();
        this.activeWidget?.destroy();
        this.options.sidebarContainer.innerHTML = '';
        this.options.settingsContainer.innerHTML = '';
    }

    /**
     * @private
     */
    _validateOptions(options) {
        if (!options.sidebarContainer || !options.settingsContainer) {
            throw new Error('SettingsWorkspace 需要 "sidebarContainer" 和 "settingsContainer" 选项。');
        }
        // --- [核心重构] 更改验证逻辑 ---
        if (!options.configManager || typeof options.configManager.modules?.get !== 'function') {
            throw new Error('SettingsWorkspace 构造函数需要一个有效的 "configManager" 实例。');
        }
        if (!options.namespace) {
            throw new Error('SettingsWorkspace 构造函数需要一个唯一的 "namespace" 字符串。');
        }
        // [MODIFIED] - 验证现在检查最终的 `widgets` 数组。
        // 注意：这里我们验证的是传入的options.widgets，因为finalWidgets是在构造函数内部生成的
        if (options.widgets && !Array.isArray(options.widgets)) {
             throw new Error('SettingsWorkspace 的 "widgets" 选项必须是一个数组。');
        }
    }
    
    /**
     * @private
     * @param {Event} event
     * @description 处理窗口/标签页关闭前的事件，以防止数据丢失。
     */
    _handleBeforeUnload(event) {
        if (this.isDirty) {
            const message = '您有未保存的更改，确定要离开吗？';
            event.returnValue = message; // 兼容旧版浏览器
            return message; // 兼容现代浏览器
        }
    }
}

/**
 * 工厂函数，用于创建和初始化一个新的 SettingsWorkspace 实例。
 * @param {SettingsWorkspaceOptions} options - 工作区的配置。
 * @returns {SettingsWorkspace} 一个新的实例。
 */
export function createSettingsWorkspace(options) {
    return new SettingsWorkspace(options);
}