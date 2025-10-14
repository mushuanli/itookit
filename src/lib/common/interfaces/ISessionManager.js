/**
 * #common/interfaces/ISessionManager.js
 * @file ISessionManager - 定义了一个会e话管理模块（如下一代的侧边栏）必须实现的公共接口。
 * 任何实现了此接口的类都可以被主应用程序（如 MDxWorkspace）集成，
 * 作为一个独立的、可交互的内容管理面板。
 *
 * 该文件是模块间的核心“契约”，它不仅定义了方法，还定义了配置对象的结构。
 * @interface
 */


// --- 类型定义 (Type Definitions) ---

/**
 * 定义了上下文菜单中单个可操作项的结构。
 * @typedef {object} MenuItem
 * @property {string} id - 动作的唯一标识符，例如 'rename' 或 'delete'。
 * @property {string} label - 显示在菜单中的文本，例如 "重命名"。
 * @property {string} [iconHTML] - 用于显示图标的 HTML 字符串，例如 '<i class="fas fa-trash"></i>'。
 * @property {'item' | 'separator'} [type='item'] - 项目类型。'separator' 会渲染一条分割线。
 * @property {(item: object) => boolean} [hidden] - 一个函数，根据当前操作的 item 动态决定是否隐藏此菜单项。
 */

/**
 * 一个回调函数，用于动态构建或修改特定条目的上下文菜单。
 * @callback ContextMenuBuilder
 * @param {object} item - 被右键点击的条目（会话或文件夹）的数据对象。
 * @param {MenuItem[]} defaultItems - 库生成的默认菜单项数组。
 * @returns {MenuItem[]} 最终要在菜单中显示的菜单项数组。
 */

/**
 * 上下文菜单的配置对象。
 * @typedef {object} ContextMenuConfig
 * @property {ContextMenuBuilder} [items] - 提供一个自定义函数来完全控制菜单项。
 */

/**
 * 用于初始化会话管理器（如 SessionUIManager）的配置选项对象。
 * 这是与管理器交互的主要配置入口。
 * @typedef {object} SessionUIOptions
 * @property {HTMLElement} sessionListContainer - 【必需】用于承载会话列表的主 HTML 元素。
 * @property {HTMLElement} [documentOutlineContainer] - (可选) 用于承载激活文档大纲的 HTML 元素。如果提供，将启用大纲功能。
 * @property {string} storageKey - 【必需】用于本地持久化存储的唯一键。这确保了多个管理器实例之间的数据隔离。
 * @property {object} [initialState] - (可选) 用于覆盖默认值的初始状态对象。
 * @property {import('../store/adapters/IPersistenceAdapter.js').IPersistenceAdapter} [persistenceAdapter] - (可选) 提供一个自定义的持久化适配器。默认为 LocalStorageAdapter。
 * @property {ContextMenuConfig} [contextMenu] - (可选) 自定义右键上下文菜单。
 * @property {boolean} [readOnly=false] - (可选) 如果为 true，则启用只读模式，禁用所有创建、编辑、删除功能。
 * @property {boolean} [initialSidebarCollapsed=false] - (可选) 初始状态下侧边栏是否为折叠状态。
 * @property {string} [title='会话列表'] - (可选) 设置侧边栏顶部显示的标题。
 * @property {string} [searchPlaceholder='搜索...'] - (可选) 自定义搜索框的提示文本。
 * @property {string} [newSessionContent=''] - (可选) 创建新会话时的默认初始内容。
 * @property {object} [components] - (可选) 提供自定义组件以覆盖默认实现。
 * @property {Function} [components.tagEditor] - (可选) 一个标签编辑器组件的工厂函数。
 */


// --- 接口类 (Interface Class) ---

/**
 * ISessionManager 接口类。
 * @interface
 *
 * @example
 * // --- 使用示例 ---
 * import { createSessionUI } from './sidebar/index.js'; // 假设这是实现类库的入口
 *
 * // 1. 定义配置
 * const options = {
 *   sessionListContainer: document.getElementById('my-sidebar'),
 *   documentOutlineContainer: document.getElementById('my-outline'),
 *   storageKey: 'workspace-alpha',
 *   title: '我的项目',
 *   readOnly: false,
 * };
 *
 * // 2. 创建管理器实例
 * const sessionManager = createSessionUI(options);
 *
 * // 3. 订阅事件
 * sessionManager.on('sessionSelected', ({ item }) => {
 *   if (item) {
 *     console.log(`会话 "${item.metadata.title}" 被选中。`);
 *     // 在编辑器中加载 item.content.data
 *   }
 * });
 *
 * sessionManager.on('sidebarStateChanged', ({ isCollapsed }) => {
 *   console.log(`侧边栏状态变为: ${isCollapsed ? '折叠' : '展开'}`);
 * });
 *
 * // 4. 启动管理器
 * async function initialize() {
 *   const activeSession = await sessionManager.start();
 *   if (activeSession) {
 *     console.log('管理器启动，初始激活的会话是:', activeSession.metadata.title);
 *   } else {
 *     console.log('管理器启动，没有激活的会话。');
 *   }
 * }
 *
 * initialize();
 *
 */
export class ISessionManager {
    /**
     * @protected
     * @throws {Error} - 防止直接实例化此接口类。
     */
    constructor() {
        if (this.constructor === ISessionManager) {
            throw new Error("ISessionManager is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * 核心服务对象，提供对会话数据的底层访问和操作（增、删、改、查等）。
     * 必须被实现为一个 getter。
     * @returns {import('./ISessionService.js').ISessionService}
     * @readonly
     */
    get sessionService() {
        throw new Error("Property 'sessionService' must be implemented.");
    }

    /**
     * 初始化会话管理器，加载持久化数据，渲染UI，并返回初始时应被激活的会话项目。
     * @returns {Promise<object|undefined>} Promise 解析为一个代表当前激活项目的数据对象，
     *                                      如果没有激活的会话则为 undefined。
     */
    async start() {
        throw new Error("Method 'start' must be implemented.");
    }

    /**
     * 同步获取当前激活的会话项目对象。
     * @returns {object|undefined} 当前激活的项目对象，如果未选择任何项目则为 undefined。
     */
    getActiveSession() {
        throw new Error("Method 'getActiveSession' must be implemented.");
    }

    /**
     * 从外部更新指定会话的内容。实现者需要负责重新解析内容（如摘要、大纲）并持久化变更。
     * 这是将外部编辑器内容同步回侧边栏的标准方法。
     * @param {string} sessionId - 要更新的会话的唯一 ID。
     * @param {string} newContent - 新的完整内容。
     * @returns {Promise<void>}
     */
    async updateSessionContent(sessionId, newContent) {
        throw new Error("Method 'updateSessionContent' must be implemented.");
    }

    /**
     * 切换侧边栏的显示/隐藏（折叠/展开）状态。
     * 实现类内部应管理该状态，并可能触发 `sidebarStateChanged` 事件。
     * @returns {void}
     */
    toggleSidebar() {
        throw new Error("Method 'toggleSidebar' must be implemented.");
    }

    /**
     * 动态设置侧边栏的标题。
     * @param {string} newTitle - 新的标题文本。
     * @returns {void}
     */
    setTitle(newTitle) {
        throw new Error("Method 'setTitle' must be implemented.");
    }

    /**
     * [增强描述] 订阅由会话管理器发出的公共事件。
     * @param {'sessionSelected' | 'navigateToHeading' | 'importRequested' | 'sidebarStateChanged' | 'menuItemClicked' | 'stateChanged'} eventName - 要订阅的事件名称。
     * @param {(payload: object) => void} callback - 事件触发时调用的回调函数。
     *   - **sessionSelected**: 当用户选择一个会话时触发。
     *     - `payload`: `{ item: object | undefined }`
     *   - **navigateToHeading**: 当用户点击大纲中的标题时触发。
     *     - `payload`: `{ elementId: string }`
     *   - **importRequested**: 当用户点击导入按钮时触发。
     *     - `payload`: `{ parentId: string | null }`
     *   - **sidebarStateChanged**: [已废弃, 请使用 'stateChanged'] 当侧边栏的折叠状态改变时触发。
     *     - `payload`: `{ isCollapsed: boolean }`
     *   - **menuItemClicked**: 当用户点击一个自定义的上下文菜单项时触发。
     *     - `payload`: `{ actionId: string, item: object }`
     *   - **[新增] stateChanged**: 当侧边栏的任何重要状态（如只读、折叠）发生变化时触发。
     *     - `payload`: `{ isReadOnly: boolean, isCollapsed: boolean }`
     * @returns {Function} 一个用于取消订阅的函数。
     */
    on(eventName, callback) {
        throw new Error("Method 'on' must be implemented.");
    }

    /**
     * 销毁管理器实例，清理所有内部状态、DOM 元素和事件监听器，释放资源。
     * @returns {void}
     */
    destroy() {
        throw new Error("Method 'destroy' must be implemented.");
    }
}
