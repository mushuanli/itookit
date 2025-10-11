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
     * 订阅编辑器触发的事件。
     * @param {'change'} eventName - 要订阅的事件名称。目前，只需要 'change' 事件。
     * @param {Function} callback - 事件触发时要调用的函数。
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
