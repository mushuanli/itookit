/**
 * @file Manages plugin registration, lifecycle, and context creation.
 */
import { MDxEditor } from '../editor/index.js';
// [NEW] 导入 IPersistenceAdapter 接口

export class PluginManager {
    /**
     * @param {MDxRenderer | MDxEditor} coreInstance
     * @param {import('./service-container.js').ServiceContainer} serviceContainer
     * @param {import('../../common/store/adapters/IPersistenceAdapter.js').IPersistenceAdapter | null} dataAdapter
     */
    constructor(coreInstance, serviceContainer, dataAdapter = null) {
        this.coreInstance = coreInstance;
        this.serviceContainer = serviceContainer;
        this.dataAdapter = dataAdapter; // [NEW] Store the data adapter

        /** @type {Map<string, import('./plugin.js').MDxPlugin>} */
        this.plugins = new Map();
        
        // Registries
        this.hooks = new Map();
        this.syntaxExtensions = [];
        this.commands = {};
        this.toolbarButtons = [];
        this.titleBarButtons = []; // [MODIFIED] Add registry for title bar buttons
        this.eventBus = new Map();
        // [NEW] A registry for CodeMirror extensions provided by plugins.
        this.codeMirrorExtensions = [];
    }

    /**
     * Registers and installs a plugin.
     * @param {import('./plugin.js').MDxPlugin} plugin
     */
    register(plugin) {
        if (this.plugins.has(plugin.name)) {
            console.warn(`Plugin "${plugin.name}" is already registered.`);
            return;
        }
        const context = this.createContextFor(plugin);
        plugin.install(context);
        this.plugins.set(plugin.name, plugin);
    }
    
    // --- [NEW] Public Event Bus Methods ---
    
    /**
     * Emits a global event to all listeners.
     * @param {string} eventName - The name of the event.
     * @param {any} payload - The data to pass to listeners.
     */
    emit(eventName, payload) {
        const listeners = this.eventBus.get(eventName) || [];
        listeners.forEach(cb => cb(payload));
    }

    /**
     * Listens for a global event.
     * @param {string} eventName - The name of the event to listen for.
     * @param {(payload: any) => void} callback - The function to execute when the event is emitted.
     */
    listen(eventName, callback) {
        if (!this.eventBus.has(eventName)) this.eventBus.set(eventName, []);
        this.eventBus.get(eventName).push(callback);
    }

    /**
     * Creates the context object (facade) for a given plugin.
     * @param {import('./plugin.js').MDxPlugin} plugin
     * @returns {import('./plugin.js').PluginContext}
     */
    createContextFor(plugin) {

        const context = {
            // Renderer & Common
            registerSyntaxExtension: (ext) => this.syntaxExtensions.push(ext),
            on: (hook, callback) => {
                if (!this.hooks.has(hook)) this.hooks.set(hook, []);
                this.hooks.get(hook).push(callback);
            },
            provide: (key, service) => this.serviceContainer.provide(key, service),
            inject: (key) => this.serviceContainer.inject(key),
            
            // [MODIFIED] Point context methods to the public PluginManager methods
            emit: this.emit.bind(this),
            listen: this.listen.bind(this),

            // [NEW] Provide scoped storage API to plugins
            getScopedStore: () => {
                if (!this.dataAdapter) {
                    // Fallback to a non-persistent in-memory store if no adapter is provided.
                    // This ensures plugins don't crash and can still function without persistence.
                    console.warn(`[MDxEditor] No dataAdapter provided. State for plugin "${plugin.name}" will not be persisted.`);
                    const memStore = new Map();
                    return {
                        get: async (key) => memStore.get(key),
                        set: async (key, value) => { memStore.set(key, value); },
                        remove: async (key) => { memStore.delete(key); },
                    };
                }
                
                // Return a wrapped adapter that automatically prefixes keys with the plugin's name,
                // ensuring data isolation between plugins.
                const prefix = `plugin::${plugin.name}::`;
                return {
                    get: async (key) => this.dataAdapter.get(prefix + key),
                    set: async (key, value) => this.dataAdapter.set(prefix + key, value),
                    remove: async (key) => this.dataAdapter.remove(prefix + key),
                };
            },

            // Editor specific placeholders
            registerCommand: () => {},
            registerToolbarButton: () => {},
            // [NEW] Add a placeholder for the new method
            registerCodeMirrorExtension: () => {},
            registerTitleBarButton: () => {}, // [MODIFIED] Add placeholder
            // [NEW] Advanced editor capabilities, exposed safely to plugins
            renderInElement: () => Promise.resolve(),
            findAndSelectText: () => {},
            switchToMode: () => {},
        };

        if (this.coreInstance instanceof MDxEditor) {
            context.registerCommand = (name, fn) => { this.commands[name] = fn; };
            context.registerToolbarButton = (config) => { this.toolbarButtons.push(config); };
            context.registerCodeMirrorExtension = (ext) => { this.codeMirrorExtensions.push(ext); };
            
            // [MODIFIED] Implement the method for editor instances.
            context.registerTitleBarButton = (config) => {
                // Add a default location if not specified
                config.location = config.location || 'right';
                this.titleBarButtons.push(config);
            };

            context.renderInElement = (element, markdown) => this.coreInstance._renderer.render(element, markdown);
            context.findAndSelectText = (text) => this.coreInstance._findAndSelectText(text);
            context.switchToMode = (mode) => this.coreInstance.switchTo(mode);
        }
        
        return context;
    }

    /**
     * [RENAMED & FIXED] Executes a synchronous hook where each handler transforms a value.
     * @param {string} hookName
     * @param {any} initialValue
     * @returns {any}
     */
    executeTransformHook(hookName, initialValue) {
        const handlers = this.hooks.get(hookName) || [];
        // 为了兼容旧的 { markdown, options } 结构，这里需要一点点适配
        // 新的 hook 处理器会接收一个对象并返回一个对象
        // 如果旧的 hook 只是修改 markdown 字符串，它可能只返回字符串。
        // 所以我们在这里检查并适配。
        return handlers.reduce((acc, handler) => {
            const result = handler(acc);
            // 确保始终返回一个带有 markdown 和 options 属性的对象
            if (typeof result === 'string') {
                return { markdown: result, options: acc.options };
            }
            return result;
        }, initialValue);
    }

    /**
     * [NEW] Executes a synchronous hook where each handler performs an action with the same payload.
     * @param {string} hookName
     * @param {any} payload
     */
    executeActionHook(hookName, payload) {
        const handlers = this.hooks.get(hookName) || [];
        handlers.forEach(handler => handler(payload));
    }

    /**
     * Executes an asynchronous hook in parallel.
     * @param {string} hookName
     * @param {any} payload
     */
    async executeHookAsync(hookName, payload) {
        const handlers = this.hooks.get(hookName) || [];
        await Promise.all(handlers.map(handler => handler(payload)));
    }

    destroy() {
        for (const plugin of this.plugins.values()) {
            if (plugin.destroy) {
                plugin.destroy();
            }
        }
        // Clear event listeners to prevent memory leaks
        this.eventBus.clear();
    }
}
