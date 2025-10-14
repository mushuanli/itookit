/**
 * #common/interfaces/IEditor.js
 * @file IEditor - 定义了任何编辑器组件为与 MDxWorkspace 兼容所必须实现的接口。
 * @interface
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
     * [新增] 动态设置编辑器的只读状态。
     * @param {boolean} isReadOnly - 如果为 true，编辑器应变为不可编辑状态；否则为可编辑。
     * @returns {void}
     */
    setReadOnly(isReadOnly) {
        throw new Error("必须实现 'setReadOnly' 方法。");
    }

    /**
     * [新增] 使编辑器获得输入焦点。
     * @returns {void}
     */
    focus() {
        throw new Error("必须实现 'focus' 方法。");
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
