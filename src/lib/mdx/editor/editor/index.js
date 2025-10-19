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
        script.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
        document.head.appendChild(script);
    });
    loadedScripts.set(src, promise);
    return promise;
}

// ===================================================================
//   MDxEditor 主类定义
// ===================================================================

/**
 * MDxEditor 编排 CodeMirror 视图、渲染器预览以及一个强大的插件系统，
 * 作为一个符合 IEditor 接口的完整编辑器组件。
 * @implements {IEditor}
 */
export class MDxEditor extends IEditor {
    /**
     * 初始化 MDxEditor.
     * @param {HTMLElement} container - 宿主元素.
     * @param {object} options - 配置选项 (具体选项请参考 IEditor 及 MDxEditor 特定选项的 JSDoc).
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
            throw new Error("MDxEditor 需要一个容器元素。");
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
                // [接口实现] 发出 'change' 事件，并附带载荷
                if (update.docChanged) {
                    this._emit('change', { fullText: this.getText() });
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
        
        // --- [新增] 粘合代码：将插件的领域事件转换为 IEditor 的标准事件 ---
        this.pluginManager.listen('taskToggled', () => {
            this._emit('interactiveChange', { fullText: this.getText() });
        });
        this.pluginManager.listen('clozeGraded', () => {
            this._emit('interactiveChange', { fullText: this.getText() });
        });

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

        // [接口实现] 在所有初始化完成后，发出 'ready' 事件
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
     * 公共 API: 获取当前 markdown 文本。
     * @returns {string}
     */
    getText() {
        return this._coreEditor.getText();
    }
    
    /**
     * @override
     * [新增] 对于标准的 Markdown 编辑器，我们没有特定的摘要逻辑，
     * 因此返回 null，告知宿主环境使用默认的截断摘要方法。
     */
    async getSummary() {
        return null;
    }

    /**
     * 公共 API: 设置 markdown 文本。
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
            console.warn("在 'edit' 模式下 navigateTo 尚未完全实现。临时切换到渲染模式进行导航。");
            this.switchTo('render');
            await new Promise(resolve => setTimeout(resolve, 100)); // 等待 DOM 更新
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
            this._coreEditor.view.contentDOM.contentEditable = !isReadOnly;
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
     * Cleans up the editor instance and its resources.
     * @override
     */
    destroy() {
        // Destroy plugins first to clean up listeners, etc.
        this._eventListeners.clear();
        this.pluginManager.destroy();
        this._coreEditor.destroy();
        this._renderer.destroy();
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
            if (!isInitial) this.focus();
        }

        // Update the toggle button's appearance (managed by CoreTitleBarPlugin)
        this.pluginManager.emit('modeChanged', { mode, editor: this });
        this._emit('modeChanged', { mode }); // Emit public event as well

        if (!isInitial) setTimeout(() => this._syncScroll(), 0);
    }

    // ===================================================================
    //   [重构] 公共搜索 API (Public Search API)
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
     * @param {string} query - 要搜索的文本。
     * @returns {Promise<UnifiedSearchResult[]>}
     */
    async search(query) {
        this.clearSearch();
        if (!query || query.trim() === '') {
            return [];
        }

        // 1. 在 CodeMirror 编辑器中搜索
        const editorMatches = this._searchInEditor(query);
        const editorResults = editorMatches.map(match => {
            const line = this.editorView.state.doc.lineAt(match.from);
            return {
                source: 'editor',
                text: this.editorView.state.doc.sliceString(match.from, match.to),
                context: line.text.trim(),
                details: match // { from, to }
            };
        });

        // 2. 在渲染视图中搜索
        await this._renderContent(); // 确保渲染内容是最新
        const rendererMatches = this._renderer.search(query);
        const rendererResults = rendererMatches.map(markElement => {
            const contextElement = markElement.closest('p, li, h1, h2, h3, h4, h5, h6, pre, td') || markElement.parentElement;
            return {
                source: 'renderer',
                text: markElement.textContent,
                context: contextElement.textContent.trim().substring(0, 200), // 上下文截断
                details: markElement // HTMLElement
            };
        });

        // 按在文档中出现的顺序粗略排序
        const combinedResults = [...editorResults, ...rendererResults];
        combinedResults.sort((a, b) => {
            const posA = a.source === 'editor' ? a.details.from : 0; // 简单处理，未来可优化
            const posB = b.source === 'editor' ? b.details.from : 0;
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
            this.editorView.dispatch({
                selection: { anchor: result.details.from, head: result.details.to },
                effects: EditorView.scrollIntoView(result.details.from, { y: "center" })
            });
            this.editorView.focus();
        } else if (result.source === 'renderer') {
            this.switchTo('render');
            this._renderer.gotoMatch(result.details);
        }
    }

    /**
     * @override
     */
    clearSearch() {
        // 清除 CodeMirror 高亮
        this.editorView.dispatch({
            effects: StateEffect.define().of(new SearchQuery({ search: '' }))
        });
        // 清除渲染视图高亮
        this._renderer.clearSearch();
    }
    
    // --- 私有辅助方法 ---

    /**
     * 内部函数，仅在 CodeMirror 编辑器中执行搜索。
     * @private
     * @param {string} query
     * @returns {Array<{from: number, to: number}>}
     */
    _searchInEditor(query) {
        // 激活 CodeMirror 的内置高亮
        const searchQuery = new SearchQuery({ search: query, caseSensitive: false });
        this.editorView.dispatch({
            effects: StateEffect.define().of(searchQuery)
        });
        
        // 手动查找所有匹配项以返回它们的位置
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

    _loadDependencies() {
        loadScript('https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js', 'MathJax-script')
            .catch(err => console.error("MDxEditor: MathJax 加载失败。", err));
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

    // +++ START MODIFICATION +++
    const toolbarHTML = this.showToolbar ? `
        <div class="mdx-toolbar">
            <div class="mdx-toolbar-main-controls"></div>
            <div class="mdx-toolbar-mode-switcher"></div>
        </div>
    ` : '';

    this.container.innerHTML = `
        ${titleBarHTML}
        ${toolbarHTML} 
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
