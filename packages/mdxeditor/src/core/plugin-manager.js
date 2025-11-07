/**
 * @file mdxeditor/core/plugin-manager.js
 * @description Manages plugin registration, lifecycle, and context creation.
 */
import { MDxRenderer, MDxEditor } from '../editor/index.js';
import { ServiceContainer } from './service-container.js';

// By defining these here, we tell JSDoc what the simple names refer to.
/** @typedef {import('@itookit/common').IPersistenceAdapter} IPersistenceAdapter */
/** @typedef {import('./plugin.js').MDxPlugin} MDxPlugin */
/** @typedef {import('./plugin.js').PluginContext} PluginContext */

export class PluginManager {
    /**
     * @param {MDxRenderer | MDxEditor} coreInstance
     * @param {ServiceContainer} serviceContainer
     * @param {IPersistenceAdapter | null} dataAdapter
     */
    constructor(coreInstance, serviceContainer, dataAdapter = null) {
        this.coreInstance = coreInstance;
        this.serviceContainer = serviceContainer;
        this.dataAdapter = dataAdapter;

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

            getScopedStore: () => {
                if (!this.dataAdapter) {
                    console.warn(`[MDxEditor] No dataAdapter provided. State for plugin "${plugin.name}" will not be persisted.`);
                    const memStore = new Map();
                    return {
                        get: async (key) => memStore.get(key),
                        set: async (key, value) => { memStore.set(key, value); },
                        remove: async (key) => { memStore.delete(key); },
                    };
                }
                
                const prefix = `plugin::${plugin.name}::`;
                return {
                    get: async (key) => this.dataAdapter.getItem(prefix + key),
                    set: async (key, value) => this.dataAdapter.setItem(prefix + key, value),
                    remove: async (key) => this.dataAdapter.removeItem(prefix + key),
                };
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
}
