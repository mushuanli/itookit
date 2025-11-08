/**
 * @file mdxeditor/editor/index.js
 * @description The MDxEditor class, now a lean plugin orchestrator.
 */

import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { MDxCoreEditor } from './core-editor.js';
import { MDxRenderer } from './renderer.js';

// Core MDx library imports
import { PluginManager } from '../core/plugin-manager.js';
import { ServiceContainer } from '../core/service-container.js';
import { IEditor } from '@itookit/common';

// Import the new core plugins that encapsulate default functionality
import { CoreEditorPlugin } from '../mdxplugins/core-editor.plugin.js';
import { ToolbarPlugin } from '../mdxplugins/toolbar.plugin.js';
import { SourceSyncPlugin } from '../mdxplugins/source-sync.plugin.js';
import { CoreTitleBarPlugin } from '../mdxplugins/core-titlebar.plugin.js';
import { ClozeControlsPlugin } from '../mdxplugins/cloze-controls.plugin.js';

/** @typedef {import('@itookit/common').UnifiedSearchResult} UnifiedSearchResult */
/** @typedef {import('@itookit/common').SearchResultSource} SearchResultSource */
/** @typedef {import('../core/plugin.js').MDxPlugin} MDxPlugin */
/** @typedef {import('@itookit/common').IPersistenceAdapter} IPersistenceAdapter */

// Dependency Management
import '@fortawesome/fontawesome-free/css/all.min.css';

const loadedScripts = new Map();
/**
 * Dynamically loads a script, preventing duplicate loading.
 * @param {string} src The script source URL.
 * @param {string} [id] The ID to assign to the script element.
 * @returns {Promise<void>}
 */
function loadScript(src, id) {
    if (loadedScripts.has(src)) {
        return loadedScripts.get(src);
    }
    const promise = new Promise((resolve, reject) => {
        // If a script with the same ID already exists on the page, resolve immediately
        if (id && document.getElementById(id)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        if (id) script.id = id;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
    loadedScripts.set(src, promise);
    return promise;
}

const setSearchEffect = StateEffect.define/*<SearchQuery>*/();

/**
 * MDxEditor orchestrates the CodeMirror view, the renderer preview, and a powerful plugin system,
 * acting as a complete editor component that conforms to the IEditor interface.
 * @implements {IEditor}
 */
export class MDxEditor extends IEditor {
    /**
     * Initializes MDxEditor.
     * @param {HTMLElement} container - The host element.
     * @param {object} options - Configuration options.
     * @param {MDxPlugin[]} [options.plugins=[]] - An array of plugins.
     * @param {string} [options.initialText=''] - The initial markdown content.
     * @param {boolean} [options.showToolbar=true] - Whether to display the toolbar.
     * @param {boolean} [options.showTitleBar=true] - Whether to display the title bar.
     * @param {('edit'|'render')} [options.initialMode='edit'] - The initial view mode.
     * @param {IPersistenceAdapter} [options.dataAdapter] - An adapter for plugins to persist their private data.
     * @param {import('@itookit/vfs-core').VFSCore} [options.vfsCore] - VFS manager instance (recommended for persistence).
     * @param {string} [options.nodeId] - Current document node ID (required when using VFS).
     * @param {boolean} [options.clozeControls=false] - If true, displays floating buttons for controlling clozes in render mode. Requires `ClozePlugin` to be active.
     * @param {object} [options.titleBar] - Configuration for the title bar.
     * @param {string} [options.titleBar.title] - The text to display in the title bar.
     * @param {() => void} [options.titleBar.toggleSidebarCallback] - Callback for the sidebar toggle button. If provided, the button is shown.
     * @param {boolean} [options.titleBar.enableToggleEditMode=false] - If true, the edit/render mode toggle button is shown.
     * @param {(text: string) => void} [options.titleBar.aiCallback] - Callback for the AI button.
     * @param {(text: string) => void} [options.titleBar.saveCallback] - Callback for the Save button.
     * @param {() => void} [options.titleBar.printCallback] - Optional callback for the Print button, overrides default window.print().
     */
    constructor(container, options) {
        super(container, options); // Call interface constructor for validation

        if (!container) {
            throw new Error("MDxEditor requires a container element.");
        }
        
        this._loadDependencies();

        this.container = container;
        this.options = options || {};
        this.initialText = this.options.initialText || '';
        this.showToolbar = this.options.showToolbar !== false;
        this.showTitleBar = this.options.showTitleBar !== false;
        this.initialMode = this.options.initialMode || 'edit';

        /** @private */
        this._eventListeners = new Map();
        /** @private @type {HTMLElement | null} */
        this.titleEl = null;

        this.mode = this.initialMode;
        this.lastScroll = { edit: 0, render: 0 };

        // Initialize the core plugin system
        this.services = new ServiceContainer();
        this.pluginManager = new PluginManager(this, this.services, {
            dataAdapter: this.options.dataAdapter,
            vfsCore: this.options.vfsCore,
            nodeId: this.options.nodeId
        }); 
        
        this._loadCorePlugins();
        (options.plugins || []).forEach(p => this.use(p));
        
        if (this.options.clozeControls) {
            this.use(new ClozeControlsPlugin());
        }

        // --- Instantiate Internal Components ---
        this._renderer = new MDxRenderer([]);
        this._renderer.pluginManager.hooks = this.pluginManager.hooks;
        this._renderer.pluginManager.syntaxExtensions = this.pluginManager.syntaxExtensions;

        // Initialize the DOM structure
        this._initDOM();
        this._initTitleBar();
        
        // Create the core editor instance internally
        this._coreEditor = new MDxCoreEditor(/** @type {HTMLElement} */ (this.editorEl), {
            initialText: this.initialText,
            extensions: this.pluginManager.codeMirrorExtensions,
            onUpdate: (update) => {
                if (update.docChanged) {
                    this._emit('change', { fullText: this.getText() });
                }
                clearTimeout(this.renderTimeout);
                this.renderTimeout = setTimeout(() => this._renderContent(), 250);
            }
        });
        
        // For compatibility, expose editorView for commands and plugins that expect it.
        this.editorView = this._coreEditor.view;

        // Emit the 'editorPostInit' event to allow plugins to perform DOM-related setup,
        // such as rendering buttons into the toolbar and title bar.
        this.pluginManager.executeActionHook('editorPostInit', { editor: this, pluginManager: this.pluginManager });
        
        // Glue code: Convert plugin domain events into standard IEditor events
        this.pluginManager.listen('taskToggled', () => {
            this._emit('interactiveChange', { fullText: this.getText() });
        });
        this.pluginManager.listen('clozeGraded', () => {
            this._emit('interactiveChange', { fullText: this.getText() });
        });

        // Listen for 'taskToggled' from TaskListPlugin to update the source document.
        this.pluginManager.listen('taskToggled', ({ taskText, isChecked }) => {
            const view = this._coreEditor.view;
            const doc = view.state.doc;
            const newChar = isChecked ? 'x' : ' ';

            for (let i = 1; i <= doc.lines; i++) {
                const line = doc.line(i);
                const match = line.text.match(/^\s*-\s\[[ xX]\]\s*(.*)/);

                if (match && match[1].trim() === taskText.trim()) {
                    const checkboxStart = line.text.indexOf('[');
                    
                    if (checkboxStart !== -1) {
                        const from = line.from + checkboxStart + 1;
                        const to = from + 1;

                        view.dispatch({
                            changes: { from, to, insert: newChar }
                        });
                        
                        this._emit('interactiveChange');
                        
                        break; 
                    }
                }
            }
        });

        this.switchTo(this.initialMode, true);

        // Emit 'ready' event after all initialization is complete
        setTimeout(() => this._emit('ready'), 0);
    }
    

    // ===================================================================
    //   IEditor Interface Implementation & Public API
    // ===================================================================

    /**
     * Exposes the plugin manager's commands to conform to the IEditor interface.
     * @override
     * @type {Readonly<Object.<string, Function>>}
     */
    get commands() {
        return this.pluginManager.commands;
    }

    /**
     * Public API: Gets the current markdown text.
     * @returns {string}
     */
    getText() {
        return this._coreEditor.getText();
    }
    
    /**
     * @override
     */
    async getSummary() {
        return null;
    }

    /**
     * Public API: Sets the markdown text.
     * @param {string} markdownText
     */
    setText(markdownText) {
        this._coreEditor.setText(markdownText);
    }

    /**
     * Public API: Dynamically updates the text in the title bar.
     * @param {string} newTitle - The new title to display.
     */
    setTitle(newTitle) {
        if (this.titleEl) {
            this.titleEl.textContent = newTitle;
        }
    }

    /**
     * @override
     */
    async navigateTo(target, options = { smooth: true }) {
        if (!target?.elementId) return;

        if (this.mode === 'render') {
            const element = this.renderEl.querySelector(`#${target.elementId}`);
            if (element) {
                element.scrollIntoView({ behavior: options.smooth ? 'smooth' : 'auto', block: 'start' });
            }
        } else {
            console.warn("navigateTo is not fully implemented in 'edit' mode. Temporarily switching to render mode for navigation.");
            this.switchTo('render');
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DOM update
            const element = this.renderEl.querySelector(`#${target.elementId}`);
            if (element) {
                element.scrollIntoView({ behavior: options.smooth ? 'smooth' : 'auto', block: 'start' });
            }
        }
    }

    /**
     * @override
     */
    setReadOnly(isReadOnly) {
        if (this._coreEditor.view) {
            this._coreEditor.view.contentDOM.contentEditable = String(!isReadOnly);
        }
        this.container.classList.toggle('is-readonly', isReadOnly);
    }

    /**
     * @override
     */
    focus() {
        if (this.mode === 'edit') {
            this._coreEditor.focus();
        }
    }
    
    /**
     * Registers an event listener.
     * @param {'change' | 'interactiveChange'} eventName - Supports 'change' and 'interactiveChange' events.
     * @param {(payload: any) => void} callback - The callback function to execute when the event fires.
     * @returns {() => void} An unsubscribe function.
     */
    on(eventName, callback) {
        if (!this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, []);
        }
        this._eventListeners.get(eventName).push(callback);

        return () => {
            const listeners = this._eventListeners.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        };
    }

    /**
     * Cleans up the editor instance and its resources.
     * @override
     */
    destroy() {
        this._eventListeners.clear();
        this.pluginManager.destroy();
        this._coreEditor.destroy();
        if (this._renderer) this._renderer.destroy();
        this.container.innerHTML = '';
        this.container.classList.remove('mdx-container', 'edit-mode', 'render-mode', 'is-readonly');
    }

    /**
     * Registers and installs a plugin for the editor.
     * @param {import('../core/plugin.js').MDxPlugin} plugin
     * @returns {this}
     */
    use(plugin) {
        this.pluginManager.register(plugin);
        return this;
    }

    /**
     * Public API: Accesses a service provided by a plugin.
     * @template T
     * @param {symbol | string} key - The unique key for the service.
     * @returns {T | undefined}
     */
    getService(key) {
        return this.services.inject(key);
    }


    /**
     * Public API: Toggles between 'edit' and 'render' modes.
     */
    toggleMode() {
        this.switchTo(this.mode === 'edit' ? 'render' : 'edit');
    }

    /**
     * Public API: Switches the active view between 'edit' and 'render'.
     * @param {'edit' | 'render'} mode - The view mode to switch to.
     * @param {boolean} [isInitial=false] - Flag to indicate if this is the first switch.
     */
    switchTo(mode, isInitial = false) {
        if (!isInitial && mode === this.mode) return;

        if (!isInitial) this._syncScroll();

        this.mode = mode;

        const editorEl = /** @type {HTMLElement} */ (this.editorEl);
        const renderEl = /** @type {HTMLElement} */ (this.renderEl);

        if (mode === 'render') {
            this._renderContent();
            editorEl.style.display = 'none';
            renderEl.style.display = 'block';
            this.container.classList.add('render-mode');
            this.container.classList.remove('edit-mode');
        } else {
            editorEl.style.display = 'block';
            renderEl.style.display = 'none';
            this.container.classList.add('edit-mode');
            this.container.classList.remove('render-mode');
            if (!isInitial) this.focus();
        }

        // Update the toggle button's appearance (managed by CoreTitleBarPlugin)
        this.pluginManager.emit('modeChanged', { mode, editor: this });
        this._emit('modeChanged', { mode }); // Emit public event as well

        if (!isInitial) setTimeout(() => this._syncScroll(), 0);
    }

    // ===================================================================
    //   (Public Search API)
    // ===================================================================

    /**
     * @typedef {object} EditorSearchMatch
     * @property {number} from - The starting position of the match.
     * @property {number} to - The ending position of the match.
     */

    /**
     * Finds all occurrences of a query in the editor, highlights them,
     * and returns their positions. This method is stateless.
     * @override
     * @param {string} query - The text to search for.
     * @returns {Promise<UnifiedSearchResult[]>}
     */
    async search(query) {
        this.clearSearch();
        if (!query || query.trim() === '') {
            return [];
        }

        // 1. Search in the CodeMirror editor
        const editorMatches = this._searchInEditor(query);
        
        /** @type {UnifiedSearchResult[]} */ // [FIX] Added JSDoc type annotation
        const editorResults = editorMatches.map(match => ({
            source: 'editor',
            text: this.editorView.state.doc.sliceString(match.from, match.to),
            context: this.editorView.state.doc.lineAt(match.from).text.trim(),
            details: match
        }));

        // 2. Search in the rendered view
        await this._renderContent(); // Ensure rendered content is up-to-date
        const rendererMatches = this._renderer.search(query);
        
        /** @type {UnifiedSearchResult[]} */ // [FIX] Added JSDoc type annotation
        const rendererResults = rendererMatches.map(markElement => {
            const contextElement = markElement.closest('p, li, h1, h2, h3, h4, h5, h6, pre, td') || markElement.parentElement;
            return {
                source: 'renderer',
                text: markElement.textContent || '',
                context: (contextElement?.textContent || '').trim().substring(0, 200),
                details: markElement
            };
        });

        const combinedResults = [...editorResults, ...rendererResults];
        combinedResults.sort((a, b) => {
            const posA = a.source === 'editor' ? (/** @type {{from:number}} */ (a.details)).from : 0;
            const posB = b.source === 'editor' ? (/** @type {{from:number}} */ (b.details)).from : 0;
            return posA - posB;
        });

        return combinedResults;
    }

    /**
     * @override
     * @param {UnifiedSearchResult} result
     */
    gotoMatch(result) {
        if (!result || !result.source || !result.details) return;

        if (result.source === 'editor') {
            this.switchTo('edit');
            const details = /** @type {{from: number, to: number}} */ (result.details);
            this.editorView.dispatch({
                selection: { anchor: details.from, head: details.to },
                effects: EditorView.scrollIntoView(details.from, { y: "center" })
            });
            this.editorView.focus();
        } else if (result.source === 'renderer') {
            this.switchTo('render');
            this._renderer.gotoMatch(/** @type {HTMLElement} */ (result.details));
        }
    }

    /**
     * @override
     */
    clearSearch() {
        // Clear CodeMirror highlights
        this.editorView.dispatch({
            // @ts-ignore Use the pre-defined effect type instead of calling define() again.
            effects: setSearchEffect.of(new SearchQuery({ search: '' }))
        });
        // Clear rendered view highlights
        this._renderer.clearSearch();
    }
    
    // --- private & help method ---

    /**
     * Internal function to perform a search only within the CodeMirror editor.
     * @private
     * @param {string} query
     * @returns {Array<{from: number, to: number}>}
     */
    _searchInEditor(query) {
        // Activate CodeMirror's built-in highlighting
        const searchQuery = new SearchQuery({ search: query, caseSensitive: false });
        this.editorView.dispatch({
            //  @ts-ignore
            effects: setSearchEffect.of(searchQuery)
        });
        
        // Manually find all matches to return their positions
        const matches = [];
        const doc = this.editorView.state.doc.toString();
        const normalizedQuery = query.toLowerCase();
        let position = -1;
        while ((position = doc.toLowerCase().indexOf(normalizedQuery, position + 1)) !== -1) {
            matches.push({ from: position, to: position + query.length });
        }

        return matches;
    }

    
    // ===================================================================
    //   Lifecycle Methods
    // ===================================================================
    

    // ===================================================================
    //   Private & Internal Methods
    // ===================================================================

    /**
     * Private method to load all external dependencies.
     * @private
     */
    _loadDependencies() {
        loadScript(
            'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
            'MathJax-script'
        ).catch(err => console.error("MDxEditor: Failed to load MathJax.", err));
    }


    /**
     * Emits an event to registered listeners.
     * @private
     */
    _emit(eventName, payload) {
        const listeners = this._eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(cb => cb(payload));
        }
    }


    /**
     * Loads the core plugins that provide the editor's baseline functionality.
     * @private
     */
    _loadCorePlugins() {
        this.use(new CoreEditorPlugin());
        this.use(new CoreTitleBarPlugin());
        if (this.showToolbar) {
            this.use(new ToolbarPlugin());
        }
        this.use(new SourceSyncPlugin());
    }

    /**
     * Creates the necessary DOM structure inside the container.
     * @private
     */
    _initDOM() {
        this.container.classList.add('mdx-container');

        const titleBarHTML = this.showTitleBar ? `
            <div class="mdx-title-bar">
                <div class="mdx-title-bar-controls left"></div>
                <div class="mdx-title-bar-title"></div>
                <div class="mdx-title-bar-controls right"></div>
            </div>` : '';

        const toolbarHTML = this.showToolbar ? `
            <div class="mdx-toolbar">
                <div class="mdx-toolbar-main-controls"></div>
                <div class="mdx-toolbar-mode-switcher"></div>
            </div>` : '';

        this.container.innerHTML = `
            ${titleBarHTML}
            ${toolbarHTML} 
            <div class="mdx-editor-view"></div>
            <div class="mdx-render-view rich-content-area prose max-w-none"></div>
        `;

        this.editorEl = this.container.querySelector('.mdx-editor-view');
        this.renderEl = this.container.querySelector('.mdx-render-view');
    }

    /**
     * Creates and configures the title bar buttons.
     * @private
     */
    _initTitleBar() {
        if (!this.showTitleBar) {
            return;
        }

        const titleBarEl = this.container.querySelector('.mdx-title-bar');
        this.titleEl = titleBarEl.querySelector('.mdx-title-bar-title');
        const titleBarOptions = this.options.titleBar || {};

        if (titleBarOptions.title && this.titleEl) {
            this.titleEl.textContent = titleBarOptions.title;
        }
    }
    
    /** @private */
    _renderContent() {
        const markdownText = this.getText();
        this._renderer.render(/** @type {HTMLElement} */ (this.renderEl), markdownText, {
            contextId: 'editor-preview',
            editor: this 
        });
    }
    
    /**
     * Synchronizes scroll position between editor and renderer views.
     * @private
     */
    _syncScroll() {
        if (this.mode === 'render') {
            const editorScroll = this._coreEditor.scrollDOM;
            const scrollPercent = editorScroll.scrollTop / (editorScroll.scrollHeight - editorScroll.clientHeight);
            this.lastScroll.edit = isNaN(scrollPercent) ? 0 : scrollPercent;
            const renderScroll = /** @type {HTMLElement} */ (this.renderEl);
            renderScroll.scrollTop = this.lastScroll.edit * (renderScroll.scrollHeight - renderScroll.clientHeight);
        } else {
            const renderScroll = /** @type {HTMLElement} */ (this.renderEl);
            const scrollPercent = renderScroll.scrollTop / (renderScroll.scrollHeight - renderScroll.clientHeight);
            this.lastScroll.render = isNaN(scrollPercent) ? 0 : scrollPercent;

            const editorScroll = this._coreEditor.scrollDOM;
            editorScroll.scrollTop = this.lastScroll.render * (editorScroll.scrollHeight - editorScroll.clientHeight);
        }
    }
    
    /**
     * Finds and highlights text in the CodeMirror editor.
     * This remains an internal helper for plugins like SourceSyncPlugin.
     * @param {string} text The text to find.
     */
    findAndSelectText(text) {
        const doc = this.editorView.state.doc.toString();
        const startIndex = doc.indexOf(text);
        
        if (startIndex !== -1) {
            const endIndex = startIndex + text.length;
            this.editorView.dispatch({
                selection: { anchor: startIndex, head: endIndex },
                effects: EditorView.scrollIntoView(startIndex, { y: "center" })
            });
        }
    }
}

export {MDxRenderer};