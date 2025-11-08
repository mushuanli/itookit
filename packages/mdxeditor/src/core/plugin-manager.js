/**
 * @file mdxeditor/core/plugin-manager.js
 * @description Manages plugin registration, lifecycle, and context creation.
 */
import { MDxRenderer, MDxEditor } from '../editor/index.js';
import { ServiceContainer } from './service-container.js';

// By defining these here, we tell JSDoc what the simple names refer to.
/** @typedef {import('@itookit/common').IPersistenceAdapter} IPersistenceAdapter */
/** @typedef {import('@itookit/vfs-manager').VFSManager} VFSManager */
/** @typedef {import('./plugin.js').MDxPlugin} MDxPlugin */
/** @typedef {import('./plugin.js').PluginContext} PluginContext */

export class PluginManager {
    /**
     * @param {MDxRenderer | MDxEditor} coreInstance
     * @param {ServiceContainer} serviceContainer
     * @param {object} [options]
     * @param {IPersistenceAdapter} [options.dataAdapter] - 传统持久化适配器（向后兼容）
     * @param {VFSManager} [options.vfsManager] - VFS 管理器（推荐）
     * @param {string} [options.nodeId] - 当前文档节点 ID（使用 VFS 时必需）
     */
    constructor(coreInstance, serviceContainer, options = {}) {
        this.coreInstance = coreInstance;
        this.serviceContainer = serviceContainer;
        
        // 存储配置
        this.vfsManager = options.vfsManager || null;
        this.currentNodeId = options.nodeId || null;
        this.dataAdapter = options.dataAdapter || null;
        
        // 如果同时提供了 VFS 和 dataAdapter，优先使用 VFS
        if (this.vfsManager && this.dataAdapter) {
            console.info('[PluginManager] Both VFSManager and dataAdapter provided. VFS will be preferred.');
        }

        /** @type {Map<string, MDxPlugin>} */
        this.plugins = new Map();
        
        // Registries
        this.hooks = new Map();
        this.syntaxExtensions = [];
        this.commands = {};
        this.toolbarButtons = [];
        this.titleBarButtons = [];
        this.eventBus = new Map();
        this.codeMirrorExtensions = [];
    }

    /**
     * Registers and installs a plugin.
     * @param {MDxPlugin} plugin
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
     * @param {function(any): void} callback - The function to execute when the event is emitted.
     */
    listen(eventName, callback) {
        if (!this.eventBus.has(eventName)) this.eventBus.set(eventName, []);
        this.eventBus.get(eventName).push(callback);
    }

    /**
     * Creates the context object (facade) for a given plugin.
     * @param {MDxPlugin} plugin
     * @returns {PluginContext}
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
            
            emit: this.emit.bind(this),
            listen: this.listen.bind(this),

        // 新增：访问 VFSManager
        getVFSManager: () => this.vfsManager,
        
        // 新增：获取当前文档节点ID
        getCurrentNodeId: () => this.currentNodeId,

            getScopedStore: () => {
                // 策略 1: 优先使用 VFSManager（如果可用）
                if (this.vfsManager && this.currentNodeId) {
                    return this._createVFSStore(plugin.name);
                }
                
                // 策略 2: 使用传统 dataAdapter（向后兼容）
                if (this.dataAdapter) {
                    return this._createAdapterStore(plugin.name);
                }
                
                // 策略 3: 降级到内存存储（不持久化）
                console.warn(
                    `[PluginManager] No persistence available for plugin "${plugin.name}". ` +
                    `Using in-memory store (data will not be persisted).`
                );
                return this._createMemoryStore();
            },

            // Editor specific placeholders
            registerCommand: () => {},
            registerToolbarButton: () => {},
            registerCodeMirrorExtension: () => {},
            registerTitleBarButton: () => {},
            renderInElement: () => Promise.resolve(),
            findAndSelectText: () => {},
            switchToMode: () => {},
        };

        if (this.coreInstance instanceof MDxEditor) {
            context.registerCommand = (name, fn) => { this.commands[name] = fn; };
            context.registerToolbarButton = (config) => { this.toolbarButtons.push(config); };
            context.registerCodeMirrorExtension = (ext) => { this.codeMirrorExtensions.push(ext); };
            
            context.registerTitleBarButton = (config) => {
                config.location = config.location || 'right';
                this.titleBarButtons.push(config);
            };

            const editorInstance = /** @type {MDxEditor} */ (this.coreInstance);
            context.renderInElement = (element, markdown) => editorInstance._renderer.render(element, markdown);
            context.findAndSelectText = (text) => editorInstance._findAndSelectText(text);
            context.switchToMode = (mode) => editorInstance.switchTo(mode);
        }
        
        return context;
    }

    /**
     * Executes a synchronous hook where each handler transforms a value.
     * @param {string} hookName
     * @param {any} initialValue
     * @returns {any}
     */
    executeTransformHook(hookName, initialValue) {
        const handlers = this.hooks.get(hookName) || [];
        return handlers.reduce((acc, handler) => {
            const result = handler(acc);
            if (typeof result === 'string') {
                return { markdown: result, options: acc.options };
            }
            return result;
        }, initialValue);
    }

    /**
     * Executes a synchronous hook where each handler performs an action with the same payload.
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
        this.eventBus.clear();
    }

    /**
     * 创建基于 VFS 的存储
     * @private
     */
    _createVFSStore(pluginName) {
        const vfs = this.vfsManager;
        const nodeId = this.currentNodeId;
        const prefix = `_plugin_${pluginName}_`;
        
        return {
            /**
             * 从 VNode meta 读取数据
             */
            get: async (key) => {
                try {
                    const vnode = await vfs.storage.loadVNode(nodeId);
                    if (!vnode) return null;
                    
                    const pluginData = vnode.meta[prefix];
                    return pluginData?.[key] ?? null;
                } catch (error) {
                    console.error(`[VFSStore] Failed to get ${key}:`, error);
                    return null;
                }
            },
            
            /**
             * 写入数据到 VNode meta
             */
            set: async (key, value) => {
                try {
                    const vnode = await vfs.storage.loadVNode(nodeId);
                    if (!vnode) {
                        throw new Error(`Node ${nodeId} not found`);
                    }
                    
                    if (!vnode.meta[prefix]) {
                        vnode.meta[prefix] = {};
                    }
                    
                    vnode.meta[prefix][key] = value;
                    vnode.markModified();
                    
                    await vfs.storage.saveVNode(vnode);
                } catch (error) {
                    console.error(`[VFSStore] Failed to set ${key}:`, error);
                    throw error;
                }
            },
            
            /**
             * 删除数据
             */
            remove: async (key) => {
                try {
                    const vnode = await vfs.storage.loadVNode(nodeId);
                    if (!vnode) return;
                    
                    const pluginData = vnode.meta[prefix];
                    if (pluginData && key in pluginData) {
                        delete pluginData[key];
                        vnode.markModified();
                        await vfs.storage.saveVNode(vnode);
                    }
                } catch (error) {
                    console.error(`[VFSStore] Failed to remove ${key}:`, error);
                }
            }
        };
    }

    /**
     * 创建基于 IPersistenceAdapter 的存储（向后兼容）
     * @private
     */
    _createAdapterStore(pluginName) {
        const adapter = this.dataAdapter;
        const prefix = `plugin::${pluginName}::`;
        
        return {
            get: async (key) => adapter.getItem(prefix + key),
            set: async (key, value) => adapter.setItem(prefix + key, value),
            remove: async (key) => adapter.removeItem(prefix + key)
        };
    }

    /**
     * 创建内存存储（不持久化）
     * @private
     */
    _createMemoryStore() {
        const memStore = new Map();
        
        return {
            get: async (key) => memStore.get(key),
            set: async (key, value) => { memStore.set(key, value); },
            remove: async (key) => { memStore.delete(key); }
        };
    }
}
