/**
 * #mdx/editor/editor/index.js
 * @file [REFACTORED] The MDxEditor class, now a lean plugin orchestrator.
 */

// [核心修复] 从 CodeMirror 导入 EditorView
import { EditorView } from "@codemirror/view";
// [NEW] 导入 CodeMirror 搜索和状态管理模块
import { SearchQuery } from "@codemirror/search";
import { StateEffect } from "@codemirror/state";
import { MDxCoreEditor } from './core-editor.js';
import { MDxRenderer } from '../renderer/index.js';

// Core MDx library imports
import { PluginManager } from '../core/plugin-manager.js';
import { ServiceContainer } from '../core/service-container.js';
import { IEditor } from '../../../common/interfaces/IEditor.js';

// Import the new core plugins that encapsulate default functionality
import { CoreEditorPlugin } from '../plugins/core-editor.plugin.js';
import { ToolbarPlugin } from '../plugins/toolbar.plugin.js';
import { SourceSyncPlugin } from '../plugins/source-sync.plugin.js';
// [MODIFIED] Import the new core plugin for the title bar
import { CoreTitleBarPlugin } from '../plugins/core-titlebar.plugin.js';
// [NEW] 导入我们新创建的 cloze 控制插件
import { ClozeControlsPlugin } from '../plugins/cloze-controls.plugin.js';


// ===================================================================
//   [新增] 依赖管理部分
// ===================================================================

// 1. 直接导入 CSS 依赖。构建工具会处理它，并将其注入到页面中。
// 这替代了 HTML 中的 <link rel="stylesheet" href="...">
import '@fortawesome/fontawesome-free/css/all.min.css';

// [新增] 一个辅助函数，用于动态加载脚本，避免重复加载
const loadedScripts = new Map();
function loadScript(src, id) {
    if (loadedScripts.has(src)) {
        return loadedScripts.get(src);
    }
    const promise = new Promise((resolve, reject) => {
        // 如果具有相同 ID 的脚本已存在于页面上，则直接成功
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

// ===================================================================
//   MDxEditor 主类定义
// ===================================================================

/**
 * MDxEditor orchestrates the CodeMirror view, the renderer preview,
 * and a powerful plugin system for commands and UI.
 * @implements {IEditor}
 */
export class MDxEditor extends IEditor {
    /**
     * Initializes the MDxEditor.
     * @param {HTMLElement} container - The element to host the editor and renderer.
     * @param {object} options
     * @param {import('../core/plugin.js').MDxPlugin[]} [options.plugins=[]] - An array of plugins.
     * @param {string} [options.initialText=''] - The initial markdown content.
     * @param {boolean} [options.showToolbar=true] - Whether to display the toolbar.
     * @param {boolean} [options.showTitleBar=true] - [NEW] Whether to display the title bar.
     * @param {('edit'|'render')} [options.initialMode='edit'] - The initial view mode.
     * @param {import('../../common/store/adapters/IPersistenceAdapter.js').IPersistenceAdapter} [options.dataAdapter] - [NEW] An adapter for plugins to persist their private data.
     * @param {boolean} [options.clozeControls=false] - [新增] 如果为 true, 则在渲染模式下显示用于控制 cloze 的浮动按钮。需要 `ClozePlugin` 处于激活状态。
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
            throw new Error("A container element is required for MDxEditor.");
        }
        
        // [新增] 在构造函数开始时，立即加载所有必要的外部依赖
        this._loadDependencies();

        this.container = container;
        this.options = options || {};
        this.initialText = this.options.initialText || '';
        this.showToolbar = this.options.showToolbar !== false;
        // +++ START MODIFICATION +++
        this.showTitleBar = this.options.showTitleBar !== false; // Default to true
        // +++ END MODIFICATION +++
        this.initialMode = this.options.initialMode || 'edit';

        /** @private */
        this._eventListeners = new Map();
        /** @private @type {HTMLElement | null} */
        this.titleEl = null;

        this.mode = this.initialMode;
        this.lastScroll = { edit: 0, render: 0 };

        // Initialize the core plugin system
        this.services = new ServiceContainer();
        // [MODIFIED] 将 dataAdapter 传递给 PluginManager
        this.pluginManager = new PluginManager(this, this.services, this.options.dataAdapter); 
        
        // [REFACTORED] 自动加载核心内置插件
        this._loadCorePlugins();
        (options.plugins || []).forEach(p => this.use(p));
        
        // [NEW] 根据选项，有条件地加载可选插件
        if (this.options.clozeControls) {
            this.use(new ClozeControlsPlugin());
        }

        // --- Instantiate Internal Components ---
        this._renderer = new MDxRenderer([]);
        this._renderer.pluginManager.hooks = this.pluginManager.hooks;
        this._renderer.pluginManager.syntaxExtensions = this.pluginManager.syntaxExtensions;

        // Initialize the DOM structure
        this._initDOM();
        // [NEW] Initialize the title bar based on options
        this._initTitleBar();
        
        // Create the core editor instance internally
        this._coreEditor = new MDxCoreEditor(this.editorEl, {
            initialText: this.initialText,
            extensions: this.pluginManager.codeMirrorExtensions,
            onUpdate: (update) => {
                if (update.docChanged) {
                    this._emit('change', { update });
                }
                clearTimeout(this.renderTimeout);
                this.renderTimeout = setTimeout(() => this._renderContent(), 250);
            }
        });
        
        // [COMPATIBILITY] Expose editorView for commands and plugins that expect it.
        // This acts as a stable accessor to the underlying CodeMirror view.
        this.editorView = this._coreEditor.view;

        // --- Finalize Initialization ---
        
        // [====== CORE FIX ======]
        // Emit the 'editorPostInit' event to allow plugins to perform DOM-related setup,
        // such as rendering buttons into the toolbar and title bar.
        this.pluginManager.executeActionHook('editorPostInit', { editor: this, pluginManager: this.pluginManager });
        
        // +++ START MODIFICATION: FIX for Task List State Loss +++
        // 监听由 TaskListPlugin 发出的 'taskToggled' 事件。
        // 这是解决问题的关键：创建一个从渲染视图到源文档的回调闭环。
        this.pluginManager.listen('taskToggled', ({ taskText, isChecked }) => {
            const view = this._coreEditor.view;
            const doc = view.state.doc;
            const newChar = isChecked ? 'x' : ' '; // 根据新状态确定要替换的字符

            // 遍历文档的每一行来查找匹配的任务项
            for (let i = 1; i <= doc.lines; i++) {
                const line = doc.line(i);
                // 使用正则表达式匹配任务列表项，并捕获任务文本
                // \s*-\s\[[ xX]\]\s* 匹配 "- [ ] " 或 "- [x] " 等格式
                const match = line.text.match(/^\s*-\s\[[ xX]\]\s*(.*)/);

                if (match && match[1].trim() === taskText.trim()) {
                    // 找到了匹配的行
                    const checkboxStart = line.text.indexOf('[');
                    
                    if (checkboxStart !== -1) {
                        // 计算出要替换的字符在整个文档中的精确位置
                        const from = line.from + checkboxStart + 1;
                        const to = from + 1;

                        // 创建并分发一个 CodeMirror 事务来更新文本
                        view.dispatch({
                            changes: { from, to, insert: newChar }
                        });
                        
                        // +++ NEW in response to sidebar badge issue +++
                        // 在更新源文本后，立即发出一个“交互式变更”事件。
                        // 这将通知外部容器（如 MDxWorkspace）立即处理此变更，
                        // 而不是等待延迟的 'change' 事件。
                        this._emit('interactiveChange');
                        // +++ END NEW +++
                        
                        // 找到并更新后即可退出循环
                        break; 
                    }
                }
            }
        });
        // +++ END MODIFICATION +++

        this.switchTo(this.initialMode, true);
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
     * Registers and installs a plugin for the editor.
     * @param {import('../core/plugin.js').MDxPlugin} plugin
     * @returns {this}
     */
    use(plugin) {
        this.pluginManager.register(plugin);
        return this;
    }
    /**
     * Public API: Gets the current markdown text from the editor.
     * @returns {string}
     */
    getText() {
        return this._coreEditor.getText();
    }

    /**
     * Public API: Sets the markdown text in the editor.
     * @param {string} markdownText
     */
    setText(markdownText) {
        this._coreEditor.setText(markdownText);
    }

    /**
     * [NEW] Public API: Dynamically updates the text in the title bar.
     * @param {string} newTitle - The new title to display.
     */
    setTitle(newTitle) {
        if (this.titleEl) {
            this.titleEl.textContent = newTitle;
        }
    }

    /**
     * [新增] 注册事件监听器
     * @param {'change' | 'interactiveChange'} eventName - 支持 'change' 和 'interactiveChange' 事件
     * @param {(payload: any) => void} callback - 事件触发时执行的回调函数
     * @returns {() => void} 一个用于取消订阅的函数
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
        if (mode === 'render') {
            this._renderContent();
            this.editorEl.style.display = 'none';
            this.renderEl.style.display = 'block';
            this.container.classList.add('render-mode');
            this.container.classList.remove('edit-mode');
        } else {
            this.editorEl.style.display = 'block';
            this.renderEl.style.display = 'none';
            this.container.classList.add('edit-mode');
            this.container.classList.remove('render-mode');
            if (!isInitial) this._coreEditor.focus();
        }

        // Update the toggle button's appearance (managed by CoreTitleBarPlugin)
        this.pluginManager.emit('modeChanged', { mode, editor: this });
        this._emit('modeChanged', { mode }); // Emit public event as well

        if (!isInitial) setTimeout(() => this._syncScroll(), 0);
    }

    // ===================================================================
    //   Public Search API
    // ===================================================================

    /**
     * @typedef {object} EditorSearchMatch
     * @property {number} from - The starting position of the match.
     * @property {number} to - The ending position of the match.
     */

    /**
     * Finds all occurrences of a query in the editor, highlights them,
     * and returns their positions. This method is stateless.
     * @param {string} query - The text to search for.
     * @returns {EditorSearchMatch[]} An array of all matches found.
     */
    search(query) {
        if (!query) {
            this.clearSearch();
            return [];
        }

        // 1. Dispatch an effect to tell CodeMirror's search extension
        //    what to highlight. This enables the built-in highlighting.
        const searchQuery = new SearchQuery({
            search: query,
            caseSensitive: false,
        });
        this.editorView.dispatch({
            effects: StateEffect.define().of(searchQuery)
        });
        
        // 2. Manually find all matches to return their positions to the caller.
        const matches = [];
        const doc = this.editorView.state.doc.toString();
        const normalizedQuery = query.toLowerCase();
        let position = -1;
        while ((position = doc.toLowerCase().indexOf(normalizedQuery, position + 1)) !== -1) {
            matches.push({ from: position, to: position + query.length });
        }

        return matches;
    }

    /**
     * Selects a specific match and scrolls it into view.
     * @param {EditorSearchMatch} match - A match object returned from the `search` method.
     */
    gotoMatch(match) {
        if (!match || typeof match.from !== 'number' || typeof match.to !== 'number') return;

        this.editorView.dispatch({
            selection: { anchor: match.from, head: match.to },
            effects: EditorView.scrollIntoView(match.from, { y: "center" })
        });
        this.editorView.focus();
    }

    /**
     * Clears all search highlights from the editor.
     */
    clearSearch() {
        // Dispatching an empty SearchQuery effect clears the highlights.
        this.editorView.dispatch({
            effects: StateEffect.define().of(new SearchQuery({ search: '' }))
        });
    }
    
    // ===================================================================
    //   Lifecycle Methods
    // ===================================================================
    
    /**
     * Cleans up the editor instance and its resources.
     * @override
     */
    destroy() {
        // Destroy plugins first to clean up listeners, etc.
        this._eventListeners.clear();
        this.pluginManager.destroy();
        this._coreEditor.destroy();
        this.container.innerHTML = '';
        this.container.classList.remove('mdx-container', 'edit-mode', 'render-mode');
    }

    // ===================================================================
    //   Private & Internal Methods
    // ===================================================================

    /**
     * [新增] 私有方法，用于加载所有外部依赖。
     * @private
     */
    _loadDependencies() {
        // 加载 MathJax。它会自我配置。
        // 这替代了 HTML 中的 <script src="...mathjax...">
        loadScript(
            'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
            'MathJax-script'
        ).catch(err => console.error("MDxEditor: Failed to load MathJax.", err));
        
        // 注意：marked 和 mermaid 现在是通过 npm install 和 import 来处理的，
        // 所以它们不需要在这里动态加载。
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

        // +++ START MODIFICATION +++
        const titleBarHTML = this.showTitleBar ? `
            <div class="mdx-title-bar">
                <div class="mdx-title-bar-controls left"></div>
                <div class="mdx-title-bar-title"></div>
                <div class="mdx-title-bar-controls right"></div>
            </div>` : '';

        this.container.innerHTML = `
            ${titleBarHTML}
            ${this.showToolbar ? `<div class="mdx-toolbar"></div>` : ''}
            <div class="mdx-editor-view"></div>
            <div class="mdx-render-view rich-content-area"></div>
        `;
        // +++ END MODIFICATION +++

        this.editorEl = this.container.querySelector('.mdx-editor-view');
        this.renderEl = this.container.querySelector('.mdx-render-view');
    }

    /**
     * [NEW] Creates and configures the title bar buttons.
     * @private
     */
    _initTitleBar() {
        // +++ START MODIFICATION +++
        if (!this.showTitleBar) {
            return;
        }
        // +++ END MODIFICATION +++

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
        // +++ MODIFICATION START +++
        // 将 editor 实例传递到渲染流程中，以便插件可以访问它
        this._renderer.render(this.renderEl, markdownText, { 
            contextId: 'editor-preview',
            editor: this 
        });
        // +++ MODIFICATION END +++
    }
    
    /**
     * Synchronizes scroll position between editor and renderer views.
     * @private
     */
    _syncScroll() {
        if (this.mode === 'render') {
            const editorScroll = this._coreEditor.scrollDOM; // Use core editor's scroll DOM
            const scrollPercent = editorScroll.scrollTop / (editorScroll.scrollHeight - editorScroll.clientHeight);
            this.lastScroll.edit = isNaN(scrollPercent) ? 0 : scrollPercent;
            
            const renderScroll = this.renderEl;
            renderScroll.scrollTop = this.lastScroll.edit * (renderScroll.scrollHeight - renderScroll.clientHeight);
        } else {
            const renderScroll = this.renderEl;
            const scrollPercent = renderScroll.scrollTop / (renderScroll.scrollHeight - renderScroll.clientHeight);
            this.lastScroll.render = isNaN(scrollPercent) ? 0 : scrollPercent;

            const editorScroll = this._coreEditor.scrollDOM; // Use core editor's scroll DOM
            editorScroll.scrollTop = this.lastScroll.render * (editorScroll.scrollHeight - editorScroll.clientHeight);
        }
    }
    
    /**
     * Finds and highlights text in the CodeMirror editor.
     * This remains an internal helper for plugins like SourceSyncPlugin.
     * @param {string} text The text to find.
     * @private
     */
    _findAndSelectText(text) {
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
