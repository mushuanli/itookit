/**
 * #common/interfaces/ISettingsWidget.js
 * @file ISettingsWidget.js - 定义了可插拔设置组件的接口。
 * @interface
 */
export class ISettingsWidget {
    /**
     * @protected
     */
    constructor() {
        if (this.constructor === ISettingsWidget) {
            throw new Error("ISettingsWidget 是一个接口，不能被直接实例化。");
        }
        // 一个简单的事件发射器可以在基类中实现或由接口要求。
        this._listeners = {};
    }

    /**
     * 组件的唯一标识符。
     * @type {string}
     * @readonly
     */
    get id() { throw new Error("必须实现 'id' 属性。"); }

    /**
     * 用于导航菜单的显示标签。
     * @type {string}
     * @readonly
     */
    get label() { throw new Error("必须实现 'label' 属性。"); }

    /**
     * 可选的 HTML 字符串，用于在导航菜单中显示图标。
     * @type {string | null}
     * @readonly
     */
    get iconHTML() { return null; }
    get description() { return null; }

    // --- 状态与可用性 ---
    get isDirty() { return false; }
    get badge() { return null; }
    get isAvailable() { return true; }


    /**
     * 当组件应该将自己渲染到提供的容器中时调用。
     * @param {HTMLElement} container - 用于渲染组件的 DOM 元素。
     * @param {object} dependencies - 共享的依赖项，例如，一个协调器（coordinator）。
     * @returns {Promise<void>}
     */
    async mount(container, dependencies = {}) {
        throw new Error("必须实现 'mount' 方法。");
    }

    /**
     * 当组件被隐藏时调用。应该清理容器内容。
     * @returns {Promise<void>}
     */
    async unmount() {
        throw new Error("必须实现 'unmount' 方法。");
    }

    /**
     * 当整个设置页面被销毁时调用。
     * 应执行所有资源的完全清理。
     * @returns {Promise<void>}
     */
    async destroy() {
        throw new Error("必须实现 'destroy' 方法。");
    }

    // --- 通信 (组件 ->宿主) ---
    on(eventName, callback) {
        if (!this._listeners[eventName]) this._listeners[eventName] = [];
        this._listeners[eventName].push(callback);
    }

    off(eventName, callback) {
        if (this._listeners[eventName]) {
            this._listeners[eventName] = this._listeners[eventName].filter(cb => cb !== callback);
        }
    }

    /**
     * @protected
     */
    emit(eventName, payload) {
        if (this._listeners[eventName]) {
            this._listeners[eventName].forEach(cb => cb(payload));
        }
    }
}
