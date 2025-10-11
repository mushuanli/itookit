/**
 * #mdx/editor/core/plugin.js
 * @file Defines the core interfaces for the MDx plugin system.
 */

/**
 * @typedef {import('./plugin-manager').PluginManager} PluginManager
 * @typedef {import('../editor/index.js').MDxEditor} MDxEditor
 * @typedef {import('../renderer/index.js').MDxRenderer} MDxRenderer
 * @typedef {import('@codemirror/view').EditorView} EditorView
 */

/**
 * @typedef {object} ToolbarButton
 * @property {string} id - A unique identifier for the button.
 * @property {string} title - The tooltip text for the button.
 * @property {string | HTMLElement} icon - The HTML content or text for the button.
 * @property {string} command - The name of the command to execute on click.
 */

/**
 * @typedef {object} ScopedPersistenceStore
 * @property {(key: string) => Promise<any | null>} get - 从存储中读取数据，键已自动添加插件前缀。
 * @property {(key: string, data: any) => Promise<void>} set - 将数据写入存储，键已自动添加插件前缀。
 * @property {(key: string) => Promise<void>} remove - 从存储中移除数据，键已自动添加插件前缀。
 */


/**
 * @typedef {object} PluginContext
 * The context object passed to every plugin's `install` method.
 * This is the facade that provides a safe and stable API for plugins to interact with the MDx core.
 *
 * @property {(extension: any) => void} registerSyntaxExtension - Registers a Marked.js syntax extension.
 * @property {(hook: 'beforeParse' | 'afterRender' | 'domUpdated', callback: Function) => void} on - Subscribes to a core lifecycle hook.
 * @property {(eventName: string, payload: any) => void} emit - Emits a global event to the event bus.
 * @property {(eventName: string, callback: Function) => void} listen - Listens for a global event on the event bus.
 * @property {<T>(key: symbol | string, service: T) => void} provide - Provides a service to the service container.
 * @property {<T>(key: symbol | string) => T | undefined} inject - Injects a service from the service container.
 * @property {() => ScopedPersistenceStore} getScopedStore - [NEW] 获取一个用于插件持久化其私有数据的存储接口。
 * @property {(commandName: string, commandFn: (editor: MDxEditor) => void) => void} registerCommand - (Editor only) Registers a command.
 * @property {(buttonConfig: object) => void} registerToolbarButton - (Editor only) Registers a button for the toolbar.
 * @property {(buttonConfig: object) => void} registerTitleBarButton - [NEW] (Editor only) Registers a button for the title bar.
 * @property {(extension: any) => void} registerCodeMirrorExtension - (Editor only) Registers a CodeMirror extension.
 * @property {(element: HTMLElement, markdown: string) => Promise<void>} renderInElement - (Editor only) 允许插件在任意DOM元素中渲染Markdown。
 * @property {(text: string) => void} findAndSelectText - (Editor only) 查找并选择编辑器中的文本。
 * @property {(mode: 'edit' | 'render') => void} switchToMode - (Editor only) 切换编辑器模式。
 */

/**
 * @typedef {object} MDxPlugin
 * The interface that all MDx plugins must implement.
 *
 * @property {string} name - The unique name of the plugin.
 * @property {(context: PluginContext) => void} install - The entry point for the plugin.
 * @property {() => void} [destroy] - Optional cleanup method.
 */

export const UNUSED = {}; // Dummy export to make this a module
