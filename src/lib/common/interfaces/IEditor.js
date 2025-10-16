/**
 * #common/interfaces/IEditor.js
 * @file IEditor - 定义了任何编辑器组件为与 MDxWorkspace 兼容所必须实现的接口。
 * @interface
 */


// +++ 新增类型定义 (为方便理解，直接在此处定义) +++
/**
 * @typedef {'editor' | 'renderer'} SearchResultSource
 * @description 搜索结果的来源。'editor' 代表源码视图, 'renderer' 代表渲染视图。
 */

/**
 * @typedef {object} UnifiedSearchResult
 * @description 一个标准化的搜索结果对象，屏蔽了数据源的差异。
 * @property {SearchResultSource} source - 结果来源 ('editor' 或 'renderer')。
 * @property {string} text - 匹配的文本。
 * @property {string} context - 用于UI显示的上下文片段（例如，匹配项所在的行或段落）。
 * @property {any} details - 执行 `gotoMatch` 等操作所需的源特定数据。这是一个不透明的对象，对于 'editor' 可能是 {from, to}，对于 'renderer' 可能是 HTMLElement。
 */

export class IEditor {
    /**
     * 编辑器的构造函数必须接受一个容器元素和一个选项对象。
     * @param {HTMLElement} container - 用于渲染编辑器的 DOM 元素。
     * @param {object} options - 编辑器的配置选项。
     */
    constructor(container, options) {
        if (this.constructor === IEditor) {
            throw new Error("IEditor 是一个接口，不能被直接实例化。");
        }
    }

    /**
     * 可在编辑器上执行的命令映射。
     * 键是命令名称（字符串），值是要执行的函数。
     * 命令函数通常会接收编辑器实例作为其第一个参数。
     * @type {Readonly<Object.<string, Function>>}
     * @readonly
     */
    get commands() {
        throw new Error("必须实现 'commands' 属性。");
    }

    /**
     * 替换编辑器的全部内容。
     * @param {string} markdown - 要设置的新的 Markdown 内容。
     * @returns {void}
     */
    setText(markdown) {
        throw new Error("必须实现 'setText' 方法。");
    }

    /**
     * 以 Markdown 字符串形式检索编辑器的全部内容。
     * @returns {string} 当前的 Markdown 内容。
     */
    getText() {
        throw new Error("必须实现 'getText' 方法。");
    }

    /**
     * [可选] 获取可搜索的纯文本内容
     * @returns {Promise<string>}
     */
    async getSearchableText() {
        // 默认实现：提取 getText() 中的纯文本
        const content = this.getText();
        return content
            .replace(/^#+\s/gm, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, '')
            .trim();
    }
    
    /**
     * [可选] 获取文档标题结构
     * @returns {Promise<Heading[]>}
     */
    async getHeadings() {
        return []; // 默认返回空数组，markdown 编辑器可覆盖
    }

    /**
     * [新增] 获取一个适合在UI中显示的、人类可读的摘要。
     * 如果编辑器有特定的摘要逻辑（例如，聊天记录的第一句话），它应该实现此方法。
     * 如果未实现或返回 null，宿主环境将回退到通用逻辑（例如，截取 getText() 的内容）。
     * @returns {Promise<string|null>} 一个解析为摘要字符串或 null 的 Promise。
     */
    async getSummary() {
        // 默认实现返回 null，表示使用通用回退逻辑。
        return null;
    }

    /**
     * 更新编辑器 UI 中显示的标题（例如，在标题栏中）。
     * @param {string} newTitle - 要显示的新标题。
     * @returns {void}
     */
    setTitle(newTitle) {
        throw new Error("必须实现 'setTitle' 方法。");
    }

    /**
     * [新增] 命令编辑器将视图滚动到指定的目标。
     * @param {object} target - 描述导航目标的对象。
     * @param {string} target.elementId - 目标元素在文档中的唯一 ID。
     * @param {object} [options] - 导航选项。
     * @param {boolean} [options.smooth=true] - 是否平滑滚动。
     * @returns {Promise<void>} 当导航完成时解析的 Promise。
     */
    async navigateTo(target, options) {
        throw new Error("必须实现 'navigateTo' 方法。");
    }

    /**
     * 动态设置编辑器的只读状态。
     * @param {boolean} isReadOnly - 如果为 true，编辑器应变为不可编辑状态；否则为可编辑。
     * @returns {void}
     */
    setReadOnly(isReadOnly) {
        throw new Error("必须实现 'setReadOnly' 方法。");
    }

    /**
     * 使编辑器获得输入焦点。
     * @returns {void}
     */
    focus() {
        throw new Error("必须实现 'focus' 方法。");
    }

    /**
     * [重构] 在编辑器的所有内容源（例如，源码编辑器和渲染视图）中查找查询字符串。
     * @param {string} query - 要搜索的文本。
     * @returns {Promise<UnifiedSearchResult[]>} 一个解析为统一搜索结果对象数组的 Promise。
     */
    async search(query) {
        throw new Error("必须实现 'search' 方法。");
    }

    /**
     * [新增] 将视图导航到指定的搜索结果并高亮它。
     * @param {UnifiedSearchResult} result - 从 `search` 方法返回的搜索结果对象。
     * @returns {void}
     */
    gotoMatch(result) {
        throw new Error("必须实现 'gotoMatch' 方法。");
    }

    /**
     * [新增] 清除所有搜索高亮。
     * @returns {void}
     */
    clearSearch() {
        throw new Error("必须实现 'clearSearch' 方法。");
    }


    // --- 事件系统 ---

    /**
     * [增强描述] 订阅由编辑器触发的事件。
     * @param {'change' | 'interactiveChange' | 'ready'} eventName - 要订阅的事件名称。
     *   - **'change'**: 当编辑器内容因用户输入等高频操作发生变化时触发。适用于防抖动的自动保存。
     *     - `callback(payload: { fullText: string })`
     *   - **'interactiveChange'**: 当用户执行了一个需要立即响应的交互式操作时触发（如点击任务复选框）。适用于需要立即持久化并更新UI的状态变更。
     *     - `callback(payload: { fullText: string })`
     *   - **'ready'**: 当编辑器完成初始化、完全可用时触发。
     *     - `callback()`
     * @param {(payload?: object) => void} callback - 事件触发时要调用的函数。
     * @returns {Function} 一个函数，调用该函数将取消订阅监听器。
     */
    on(eventName, callback) {
        throw new Error("必须实现 'on' 方法。");
    }

    /**
     * 销毁编辑器实例，清理所有资源、DOM 元素和事件监听器。
     * @returns {void}
     */
    destroy() {
        throw new Error("必须实现 'destroy' 方法。");
    }
}
