/**
 * @file mdxeditor/src/core/plugin.js
 * @description Defines the core interfaces for the MDx plugin system.
 */

// These typedefs import types for use within this file's JSDoc.
/** @typedef {import('./plugin-manager').PluginManager} PluginManager */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */
/** @typedef {import('../editor/renderer.js').MDxRenderer} MDxRenderer */
/** @typedef {import('@codemirror/view').EditorView} EditorView */

/**
 * @typedef {object} ToolbarButton
 * @property {string} id - A unique identifier for the button.
 * @property {string} title - The tooltip text for the button.
 * @property {string | HTMLElement} icon - The HTML content or text for the button.
 * @property {string} command - The name of the command to execute on click.
 */

/**
 * @typedef {object} ScopedPersistenceStore
 * @property {function(string): Promise<any | null>} get - Reads data from storage, with the key automatically prefixed for the plugin.
 * @property {function(string, any): Promise<void>} set - Writes data to storage, with the key automatically prefixed.
 * @property {function(string): Promise<void>} remove - Removes data from storage, with the key automatically prefixed.
 */


/**
 * @typedef {object} PluginContext
 * The context object passed to every plugin's `install` method.
 * This is the facade that provides a safe and stable API for plugins to interact with the MDx core.
 *
 * @property {function(any): void} registerSyntaxExtension - Registers a Marked.js syntax extension.
 * @property {function('editorPostInit'|'beforeParse' | 'afterRender' | 'domUpdated' | 'beforeSave', Function): void} on - Subscribes to a core lifecycle hook.
 * @property {function(string, any): void} emit - Emits a global event to the event bus.
 * @property {function(string, Function): void} listen - Listens for a global event on the event bus.
 * @property {function(symbol|string, *): void} provide - Provides a service to the service container.
 * @property {function((symbol|string)): *} inject - Injects a service from the service container.
 * 
 * @property {function(): import('@itookit/vfs-core').VFSCore | null} getVFSManager - Gets the VFSCore instance if available.
 * @property {function(): string | null} getCurrentNodeId - Gets the current document node ID if in VFS context.
 * @property {function(): ScopedPersistenceStore} getScopedStore - Gets a storage interface for the plugin to persist its private data. Automatically selects the best available backend: VFS (preferred) > dataAdapter > Memory.
 * 
 * @property {function(string, function(MDxEditor): void): void} registerCommand - (Editor only) Registers a command.
 * @property {function(object): void} registerToolbarButton - (Editor only) Registers a button for the toolbar.
 * @property {function(object): void} registerTitleBarButton - (Editor only) Registers a button for the title bar.
 * @property {function(any): void} registerCodeMirrorExtension - (Editor only) Registers a CodeMirror extension.
 * @property {function(HTMLElement, string): Promise<void>} renderInElement - (Editor only) Allows a plugin to render Markdown in an arbitrary DOM element.
 * @property {function(string): void} findAndSelectText - (Editor only) Finds and selects text in the editor.
 * @property {function(string): void} switchToMode - (Editor only) Switches the editor mode.
 */

/**
 * @typedef {object} MDxPlugin
 * The interface that all MDx plugins must implement.
 *
 * @property {string} name - The unique name of the plugin.
 * @property {function(PluginContext): void} install - The entry point for the plugin.
 * @property {function(): void} [destroy] - Optional cleanup method.
 */

export const UNUSED = {}; // Dummy export to make this a module
