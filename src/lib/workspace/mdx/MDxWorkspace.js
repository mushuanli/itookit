// 文件: @workspace/mdx/MDxWorkspace.js

/**
 * @file MDxWorkspace (V2 - Refactored)
 * @description
 * 一个功能完备的库，将 mdx-editor 和新一代的 sessionUI（通过 ConfigManager 驱动）
 * 整合成一个统一、自洽且易于使用的可复用工作区组件。
 * 
 * [V2 核心重构]
 * 此版本不再自行管理持久化层，而是通过依赖注入接收一个已初始化的 `ConfigManager` 实例。
 * 这使得多个 MDxWorkspace 实例可以共享同一个数据后端（如全局标签库），同时通过 `namespace`
 * 保持各自文档数据的隔离，完美融入了新的应用级数据管理架构。
 */

import { debounce, isClass } from '../../common/utils/utils.js';
// 编辑器核心组件及插件
import { MDxEditor, defaultPlugins, MentionPlugin, MemoryPlugin, ClozeControlsPlugin } from '../../mdx/editor/index.js';
// 侧边栏库的工厂函数和 Providers
import { createSessionUI, SessionDirProvider, SessionFileProvider } from '../../sidebar/index.js';
// 核心接口（仅用于类型提示和架构一致性）
import { ISessionManager } from '../../common/interfaces/ISessionManager.js';

// 为了向后兼容或方便使用，继续导出 Provider
export { SessionDirProvider as DirMentionProvider };
export { SessionFileProvider as FileMentionProvider };



export class MDxWorkspace {
    /**
     * 创建一个 MDxWorkspace 实例。
     * @param {object} options - 配置选项。
     * @param {import('../../config/ConfigManager.js').ConfigManager} options.configManager - [新] **必需** 一个已初始化的 ConfigManager 实例。
     * @param {string} options.namespace - [新] **必需** 此工作区实例的唯一命名空间，用于从 ConfigManager 获取对应的数据仓库。
     * @param {HTMLElement} options.sidebarContainer - **必需** 用于承载会话列表的 HTML 元素。
     * @param {HTMLElement} options.editorContainer - **必需** 用于承载编辑器的 HTML 元素。
     * @param {HTMLElement} [options.outlineContainer] - (可选) 用于承载文档大纲的 HTML 元素。
     * @param {object} [options.editor] - (可选) 编辑器专属的配置选项。
     * @param {object} [options.sidebar] - (可选) 侧边栏专属的配置选项。
     */
    constructor(options) {
        this._validateOptions(options);
        
        this.options = options;
        
        /** @private @type {import('../../config/ConfigManager.js').ConfigManager} */
        this.configManager = options.configManager;
        /** @private @type {string} */
        this.namespace = options.namespace;

        /** @private @type {MDxEditor | null} */
        this._editor = null;
        /** @private @type {ISessionManager | null} */
        this._sessionManager = null;
        /** @private @type {HTMLInputElement | null} */
        this._fileInput = null;
        /** @private */
        this._eventEmitter = new Map();
        /** @private @type {Function[]} */
        this._sessionManagerUnsubscribers = []; // [新增] 用于存储所有 sessionManager 的取消订阅函数
        /** @private */
        this._isDirty = false;
        /** @private */
        this._debouncedUpdater = debounce(async () => {
            const savedItem = await this._saveContent(true);
            if (savedItem) {
                // [MODIFIED] Emit 'item' for consistency
                this._emit('autosaved', { item: savedItem });
            }
        }, 1000); // 自动保存延迟1秒

        /**
         * 用于控制编辑器的公共命令接口。
         * 此对象在编辑器初始化后被动态填充。
         * @type {object}
         * @public @readonly
         */
        this.commands = {};
    }

    /**
     * 初始化所有组件，加载数据并渲染工作区。
     * @returns {Promise<void>}
     */
    async start() {
        // --- 1. [核心重构] 初始化 SessionUI ---
        // 不再自己创建 Adapter，而是直接使用注入的 ConfigManager。
        // createSessionUI 的新签名 `(options, configManager)` 在这里被使用。
        this._sessionManager = createSessionUI({
            ...this.options.sidebar, // 传递用户自定义的 sidebar 配置
            sessionListContainer: this.options.sidebarContainer,
            documentOutlineContainer: this.options.outlineContainer,
            storageKey: this.namespace,
            // [新增] 将只读状态从 workspace 配置传递给 sidebar
            readOnly: this.options.sidebar?.readOnly || false, 
        }, this.configManager);
        
        // [重构] 拆分事件连接，使其更清晰
        this._connectSessionManagerEvents();
        
        // --- 2. 组装编辑器的插件和 Providers ---
        const editorOptions = this.options.editor || {};
        // Provider 的依赖 `sessionService` 依然从 `_sessionManager` 获取，这部分逻辑不变
        const providerDependencies = { sessionService: this._sessionManager.sessionService };
        
        const finalProviders = (editorOptions.mentionProviders || [SessionDirProvider, SessionFileProvider])
            .map(P => isClass(P) ? new P(providerDependencies) : (typeof P === 'function' ? P(providerDependencies) : P)).filter(Boolean);
        
        // [修复] 将 finalPlugins 的声明和初始化移到这里
        const finalPlugins = [...defaultPlugins, ...(editorOptions.plugins || [])];
        if (finalProviders.length > 0) {
            finalPlugins.push(new MentionPlugin({ providers: finalProviders }));
        }

        // --- [新增] Cloze Control 功能注入 ---
        if (editorOptions.clozeControl) {
            finalPlugins.push(new MemoryPlugin(), new ClozeControlsPlugin());
        }


        // 4. 组装 MDxEditor 的最终配置
        const activeItem = await this._sessionManager.start();
        
        const defaultTitleBarOptions = {
            title: activeItem?.metadata.title || '文档',
            toggleSidebarCallback: () => this._sessionManager.toggleSidebar(),
            enableToggleEditMode: true,
            ...(editorOptions.showSaveButton !== false && { saveCallback: () => this.save() }),
        };
        const finalEditorOptions = {
            ...editorOptions, // 用户的其他 editor 配置
            plugins: finalPlugins,
            initialText: activeItem?.content?.data || '请选择或创建一个会话。',
            titleBar: { ...defaultTitleBarOptions, ...(editorOptions.titleBar || {}) },
            initialMode: editorOptions.clozeControl ? 'render' : (editorOptions.initialMode || 'edit'),
            clozeControls: editorOptions.clozeControl // [NEW] 显式传递 clozeControls 选项
        };
        
        // --- 5. 初始化 MDxEditor ---
        this._editor = new MDxEditor(this.options.editorContainer, finalEditorOptions);

        // --- 6. Dynamically create the command facade ---
        this._createCommandFacade(this._editor);
        this._connectEditorEvents();
        window.addEventListener('beforeunload', this._handleBeforeUnload);

        this._emit('ready', { workspace: this });
    }

    // ==========================================================
    // ==================== Public API ==========================
    // ==========================================================

    /** 公开内部实例，供高级用例使用 */
    get editor() { return this._editor; }
    get sessionManager() { return this._sessionManager; }

    /**
     * 订阅工作区事件。
     * @param {'ready'|'sessionSelect'|'contentChange'|'saved'|'autosaved'|'menuItemClicked'|'beforeImport'|'afterImport'|'interactiveChange'} eventName - 事件名称。
     * @param {Function} callback - 事件触发时调用的函数。
     * @returns {Function} 用于取消订阅的函数。
     */
    on(eventName, callback) {
        if (!this._eventEmitter.has(eventName)) {
            this._eventEmitter.set(eventName, []);
        }
        this._eventEmitter.get(eventName).push(callback);

        return () => {
            const listeners = this._eventEmitter.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) listeners.splice(index, 1);
            }
        };
    }

    /**
     * 销毁工作区实例，清理所有组件、事件监听器和DOM元素。
     */
    destroy() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._debouncedUpdater.cancel?.();
        
        // [修复] 取消所有 sessionManager 的事件订阅
        this._sessionManagerUnsubscribers.forEach(unsubscribe => unsubscribe());
        this._sessionManagerUnsubscribers = [];

        this._editor?.destroy();
        this._sessionManager?.destroy();
        this._fileInput?.remove();
        this._eventEmitter.clear();
    }

    /**
     * 获取当前激活的会话对象。
     * @returns {object | undefined}
     */
    getCurrentSession() {
        return this._sessionManager?.getActiveSession();
    }

    /**
     * 获取编辑器中的当前 Markdown 内容。
     * @returns {string}
     */
    getContent() {
        return this._editor?.getText() || '';
    }
    
    /**
     * 以编程方式设置编辑器内容，并准备好在下次切换或手动保存时持久化。
     * @param {string} markdown - 要设置的 Markdown 文本。
     * @returns {void}
     */
    setContent(markdown) {
        if (!this._editor || this._editor.getText() === markdown) return;
        this._editor.setText(markdown);
        // setText 会触发 'change' 事件，自动将 _isDirty 设为 true
    }
    
    /**
     * 手动触发一次保存操作。
     * @returns {Promise<object|undefined>} 保存后的会话对象，或在没有可保存内容时返回 undefined。
     */
    async save() {
        this._debouncedUpdater.cancel?.();
        const item = await this._saveContent(false);
        if (item) {
            // [MODIFIED] Emit 'item' for consistency
            this._emit('saved', { item });
        }
        return item;
    }


    /**
     * [修改] 打开文件选择对话框并导入一个或多个文件作为新会话。
     *        新会话将被智能地创建在当前选中的目录下。
     *        - 如果未选择任何项目，则导入到根目录。
     *        - 如果选择了一个文件夹，则导入到该文件夹内。
     *        - 如果选择了文件或多个项目，则操作被禁止。
     * @param {string | null | undefined} targetParentId - 可选的目标父文件夹 ID
     * @returns {Promise<object[]>} 一个包含所有新创建的会话对象的 Promise。
     */
    async importFiles(targetParentId) {
        if (!this._sessionManager) return [];
        let parentId = targetParentId;
console.log(`import into: ${targetParentId}`);

        // 如果没有传入 targetParentId，则根据当前选择智能判断（保持原有逻辑）
        if (parentId === undefined) {
            const state = this._sessionManager.store.getState();
            if (state.selectedItemIds.size > 1) { alert('导入失败：请只选择一个目标文件夹。'); return []; }
            parentId = null;
            if (state.selectedItemIds.size === 1) {
                const selectedId = state.selectedItemIds.values().next().value;
                const selectedItem = this._sessionManager.sessionService.findItemById(selectedId);
                if (selectedItem?.type === 'folder') parentId = selectedItem.id;
                else { alert('导入失败：请选择一个目标文件夹。'); return []; }
            }
        }

        // 2. 创建并配置 input 元素
        if (!this._fileInput) {
            this._fileInput = document.createElement('input');
            this._fileInput.type = 'file';
            this._fileInput.multiple = true;
            this._fileInput.accept = '.md, .txt, .markdown';
            this._fileInput.style.display = 'none';
            document.body.appendChild(this._fileInput);
        }

        // 3. 执行导入操作
        return new Promise((resolve) => {
            // 清空旧的 onchange 监听器，防止内存泄漏
            this._fileInput.onchange = null; 
            
            this._fileInput.onchange = async (event) => {
                const files = event.target.files;
                if (!files || files.length === 0) return resolve([]);
                
                // 触发导入前事件，使用我们已经计算好的 parentId
                this._emit('beforeImport', { files, targetParentId: parentId });
                try {
                    const newSessions = await Promise.all(Array.from(files).map(file => 
                        new Promise((res, rej) => {
                            const reader = new FileReader();
                            reader.onload = (e) => this.createSession({ title: this._stripFileExtension(file.name), content: e.target.result, parentId }).then(res).catch(rej);
                            reader.onerror = rej; reader.readAsText(file);
                        })
                    ));
                    this._emit('afterImport', { sessions: newSessions });
                    resolve(newSessions);
                } catch (error) { console.error("导入文件时出错:", error); alert("导入文件时出错。"); resolve([]);
                } finally { event.target.value = ''; }
            };

            this._fileInput.click();
        });
    }

    /**
     * 创建一个新的会话。
     * @param {object} options - 例如 { title: '新会话', parentId: null, content: '' }
     * @returns {Promise<object>} 新创建的会话对象。
     */
    async createSession(options) {
        if (this._sessionManager?.sessionService) {
            return this._sessionManager.sessionService.createSession(options);
        }
        throw new Error("Session Manager is not initialized.");
    }
    
    /**
     * 创建一个新的文件夹。
     * @param {object} options - 例如 { title: '新文件夹', parentId: null }
     * @returns {Promise<object>} 新创建的文件夹对象。
     */
    async createFolder(options) {
        if (this._sessionManager?.sessionService) {
            return this._sessionManager.sessionService.createFolder(options);
        }
        throw new Error("Session Manager is not initialized.");
    }

    /**
     * 删除一个或多个项目（会话或文件夹）。
     * @param {string[]} itemIds - 要删除的项目的 ID 数组。
     * @param {object} [options]
     * @param {boolean} [options.skipConfirm=false] - 是否跳过确认对话框。
     * @returns {Promise<void>}
     */
    async deleteItems(itemIds, { skipConfirm = false } = {}) {
        if (!itemIds || itemIds.length === 0) return;
        if (skipConfirm || confirm(`确定要删除 ${itemIds.length} 个项目吗？`)) {
            await this._sessionManager.sessionService.deleteItems(itemIds);
            this._emit('itemsDeleted', { itemIds });
        }
    }
    
    /**
     * [新增] 专门用于连接 SessionManager 的内部事件到 Workspace 的方法
     * @private
     */

    // ==========================================================
    // ================== Private Helper Methods ================
    // ==========================================================

    /** @private */
    _validateOptions(options) {
        // [修改] 验证新的核心依赖
        if (!options.sidebarContainer || !options.editorContainer) {
            throw new Error('MDxWorkspace 构造函数需要 "sidebarContainer" 和 "editorContainer" 选项。');
        }
        if (!options.configManager || typeof options.configManager.modules?.get !== 'function') {
            throw new Error('MDxWorkspace 构造函数需要一个有效的 "configManager" 实例。');
        }
        if (!options.namespace) {
            throw new Error('MDxWorkspace 构造函数需要一个唯一的 "namespace" 字符串。');
        }
    }
    
    /**
     * [重构] 专门连接 SessionManager 的事件到 Workspace 的方法
     * @private
     */
    _connectSessionManagerEvents() {
        const sm = this._sessionManager;
        if (!sm) return;
        
        // 使用一个数组来存储取消订阅的函数，方便在 destroy 时清理
        this._sessionManagerUnsubscribers.push(
            sm.on('importRequested', ({ parentId }) => this.importFiles(parentId)),
            sm.on('sidebarStateChanged', ({ isCollapsed }) => {
                if (this.options.sidebarContainer) {
                   this.options.sidebarContainer.style.display = isCollapsed ? 'none' : 'block';
                }
            }),
            sm.on('menuItemClicked', ({ actionId, item }) => this._emit('menuItemClicked', { actionId, item })),
            // [MODIFIED] Handle 'item' instead of 'session'
            sm.on('sessionSelected', async ({ item }) => {
                if (this._isDirty) await this.save();
                const newContent = item?.content?.data || '请选择或创建一个会话。';
                const newTitle = item?.metadata.title || '文档';
                if (this._editor) {
                    if (this._editor.getText() !== newContent) this._editor.setText(newContent);
                    this._editor.setTitle(newTitle);
                    this._editor.focus(); // [新] 切换后自动聚焦
                }
                this._isDirty = false;
                
                // [MODIFIED] Emit 'item'
                this._emit('sessionSelect', { item });
            }),

            // [新增] 使用新接口处理大纲导航
            sm.on('navigateToHeading', ({ elementId }) => {
                this._editor?.navigateTo({ elementId });
            }),

            // [新增] 使用新的 'stateChanged' 事件来同步所有状态
            sm.on('stateChanged', ({ isReadOnly, isCollapsed }) => {
                // 同步只读状态
                this._editor?.setReadOnly(isReadOnly);
                
                // 同步侧边栏折叠状态
                if (this.options.sidebarContainer) {
                   this.options.sidebarContainer.style.display = isCollapsed ? 'none' : 'block';
                }
            })
        );
    }
    
    /**
     * [新增] 专门用于连接 Editor 的事件
     * @private
     */
    _connectEditorEvents() {
        if (!this._editor) return;
        this._editor.on('change', () => {
            this._isDirty = true;
            this._debouncedUpdater();
        });

        // +++ NEW +++
        // 这个监听器处理低频但需要立即响应的交互式变更（如点击 checkbox）
        // 它会立即保存，并取消待处理的延迟保存。
        this._editor.on('interactiveChange', this._handleInteractiveChange);
        // +++ END NEW +++
    }

    // +++ NEW +++
    /**
     * 立即保存内容以响应交互式变更，并重置自动保存计时器。
     * @private
     */
    _handleInteractiveChange = async () => {
        // 取消任何即将触发的延迟保存，因为我们将立即保存。
        this._debouncedUpdater.cancel?.();
        const savedItem = await this._saveContent(false);
        if (savedItem) {
            this._emit('interactiveChangeSaved', { item: savedItem });
        }
    }
    // +++ END NEW +++


    /** @private */
    async _saveContent(isAutosave = false) {
        const activeItem = this.getCurrentSession();
        if (!activeItem) return undefined;

        const newContent = this.getContent();
        // [MODIFIED] Access content from content.data
        if (isAutosave && activeItem.content?.data === newContent) {
            return activeItem;
        }
        
        await this._sessionManager.updateSessionContent(activeItem.id, newContent);
        this._isDirty = false;
        
        const updatedItem = this.getCurrentSession();
        // [MODIFIED] Emit 'item'
        this._emit('contentChange', { item: updatedItem, content: newContent });
        return updatedItem;
    }

    /** @private */
    _createCommandFacade(editor) {
        const facade = {};
        const registeredCommands = editor.pluginManager.commands;
        for (const commandName in registeredCommands) {
            facade[commandName] = (...args) => {
                if (this._editor) {
                    registeredCommands[commandName](this._editor, ...args);
                } else {
                     console.warn(`[MDxWorkspace] Cannot execute command "${commandName}" because the editor is not available.`);
                }
            };
        }
        this.commands = facade;
    }
    
    /** @private */
    _stripFileExtension(fileName) {
        // 使用正则表达式替换掉结尾的常见Markdown后缀，不区分大小写
        return fileName.replace(/\.(md|txt|markdown)$/i, '');
    }

    /** @private */
    _emit(eventName, data) {
        (this._eventEmitter.get(eventName) || []).forEach(cb => cb(data));
    }
    
    /** @private */
    _handleBeforeUnload = (event) => {
        if (this._isDirty) {
            const message = '您有未保存的更改，确定要离开吗？';
            event.returnValue = message;
            return message;
        }
    }
}
