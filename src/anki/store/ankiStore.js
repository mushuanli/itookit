// src/anki/store/ankiStore.js

// 导入依赖的服务
import * as dataService from '../services/dataService.js';
// 只从 renderService 导入我们需要的函数
import { parseAndStructureHeadings } from '../services/renderService.js'; 
import { calculateNextReview } from '../../services/srs.js'; 
import { INITIAL_ANKI_CONTENT } from '../../common/config.js';
import { RichContentRenderer } from '../../common/RichContentRenderer.js';


const MAX_UNDO_HISTORY = 100;

class AnkiStore {
    constructor() {
        this.state = {
            // 数据状态
            currentSessionId: null,
            currentFolderId: null,
            folderStack: [],
            sessions: [],
            folders: [],
            clozeStates: {}, // { [clozeId]: { srsState..., tempVisible: boolean } }
            reviewCount: 0,
            
            // --- UI 状态 ---
            viewMode: 'preview', // 'edit' | 'preview'
            isEditorCollapsed: false,
            isSidebarVisible: true,
            selectedItemIds: new Set(),
            areAllClozesVisible: false,
            expandedHeadingIds: new Set(), // [NEW] 追踪展开的H1标题

            // --- 模态框可见性 ---
            isMoveModalVisible: false,
            isCustomStudyModalVisible: false,
            isStatsModalVisible: false,

            // --- 编辑器状态 ---
            editorContent: '',
            undoStack: [],
            redoStack: [],
            // [NEW] 状态来同步滚动位置
            editorScrollRatio: 0,
                      
            editorSelection: {
                start: 0,
                end: 0,
                text: '',
                hasSelection: false
            },

            // [REFACTORED] 用于从预览区向编辑区传递待选中文本
            pendingEditorSelection: null, // 将存储一个字符串

            previewSelection: {
                text: '',
                hasSelection: false,
                timestamp: 0
            },
                        
            // [ADDED] Stores an ordered array of cloze IDs for reliable navigation.
            clozeOrderInCurrentFile: [],

            // --- 预览状态 ---
            previewContent: '',
            // [NEW] 状态来支持Cloze导航
            lastInteractedClozeId: null,
            highlightedClozeId: null, // UI组件将监听此ID以高亮和滚动
            highlightedHeadingId: null, // [NEW] 用于标题导航
          
            // --- 复习会话状态 ---
            reviewQueue: [],
            currentReviewIndex: -1,

            // --- 临时状态 (防止竞态) ---
            isNavigating: false,
            isSaving: false,
            isUpdatingPreview: false
        };
      
        // 私有属性，不放入 state
        this._lastToggledItemId = null; 
        this.listeners = new Set();
        this.currentUpdatePromise = null; // 用于跟踪进行中的预览更新
    }
  
    /** 获取当前状态的只读副本 */
    getState() {
        return { ...this.state };
    }
  
    /** 更新状态并通知所有订阅者 */
    setState(updates) {
        const oldState = { ...this.state };
        
        // 检查是否有实际变化
        const hasChanged = Object.keys(updates).some(key => this.state[key] !== updates[key]);
        if (!hasChanged) return;

        this.state = { ...this.state, ...updates };
        this.notify(oldState, this.state);
    }
  
    /**
     * [优化] 订阅状态变化。
     * @param {function} listener - 当状态变化时要执行的回调函数。
     * @param {string[]} [keysToWatch] - (可选) 一个包含状态键名的数组。只有当这些键之一发生变化时，才会调用监听器。
     *                                   如果未提供，则任何状态变化都会触发。
     */
    subscribe(listener, keysToWatch) {
        const enhancedListener = {
            callback: listener,
            keys: keysToWatch ? new Set(keysToWatch) : null // 使用 Set 以提高查找效率
        };
        this.listeners.add(enhancedListener);
        
        return () => this.listeners.delete(enhancedListener);
    }
  
    /** 通知所有监听器状态已改变 */
    notify(oldState, newState) {
        // [优化] 检查哪些键发生了变化
        const changedKeys = new Set();
        for (const key in newState) {
            if (oldState[key] !== newState[key]) {
                changedKeys.add(key);
            }
        }
        
        if (changedKeys.size === 0) return;

        this.listeners.forEach(listenerObj => {
            // 如果监听器没有指定 keys (全局监听)，或者它关心的 key 发生了变化
            if (!listenerObj.keys || [...listenerObj.keys].some(key => changedKeys.has(key))) {
                listenerObj.callback(newState, oldState);
            }
        });
    }
  
    // ======================================================
    //                   ACTIONS (业务逻辑)
    // ======================================================

    /**
     * [新增] Action: 在编辑器内容中切换一个任务的完成状态 ([ ] <=> [x])
     * @param {string} taskTitle - 被点击的任务的标题文本.
     */
    async toggleTaskInContent(taskTitle) {
        const { editorContent } = this.state;
        
        // 为了在正则表达式中使用，需要转义标题中的特殊字符
        const escapedTitle = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // 构建一个正则表达式来精确匹配这一行
        // 它会匹配 `::> [` 加上 ` ` 或 `x` 或 `X`，然后是 `] ` 和转义后的标题
        const taskRegex = new RegExp(`(::>\\s*\\[)([ xX])(\\]\\s*${escapedTitle})`, 'm');
        
        const match = editorContent.match(taskRegex);
        
        if (match) {
            // 如果当前是 'x' 或 'X'，则切换为空格；否则，切换为 'x'
            const newCheckmark = match[2].trim().toLowerCase() === 'x' ? ' ' : 'x';
            const newContent = editorContent.replace(taskRegex, `${match[1]}${newCheckmark}${match[3]}`);
            
            this.recordUndoState(editorContent); // 记录撤销状态
            // 更新编辑器内容并触发预览更新
            this.setState({ editorContent: newContent });
            await this.updatePreview();
        } else {
            console.warn("Could not find task to toggle in editorContent:", taskTitle);
        }
    }

    /**
     * [新增功能] Action: 切换标准 GFM 任务列表项 (- [ ]) 的完成状态
     * @param {string} taskText - 被点击的任务列表项的纯文本内容.
     */
    async toggleListItemTask(taskText) {
        const { editorContent } = this.state;
        
        // 1. 转义任务文本，使其在正则表达式中安全
        const escapedText = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // 2. 构建一个更精确的正则表达式来匹配 GFM 任务列表项
        //    - (^\s*[-*+]\s*\[)  : 捕获组1: 行首，可选空格，列表标记(-,*,+)，可选空格，左括号
        //    - ([ xX])             : 捕获组2: 捕获括号内的字符（空格, x, 或 X）
        //    - (\]\s*)             : 捕获组3: 右括号和后面的空格
        //    - ${escapedText}      : 匹配任务的文本
        const listItemRegex = new RegExp(`(^\\s*[-*+]\\s*\\[)([ xX])(\\]\\s*${escapedText})`, 'm');
        
        const match = editorContent.match(listItemRegex);
        
        if (match) {
            // 3. 根据当前状态决定新的复选框标记
            const newCheckmark = match[2].trim().toLowerCase() === 'x' ? ' ' : 'x';
            
            // 4. 替换内容
            const newContent = editorContent.replace(listItemRegex, `${match[1]}${newCheckmark}${match[3]}`);
            
            // 5. 更新状态并刷新预览
            this.recordUndoState(editorContent); // 记录撤销
            this.setState({ editorContent: newContent });
            await this.updatePreview(); // 异步更新预览
        } else {
            console.warn("Could not find list item task to toggle:", taskText);
        }
    }


    async initialize() {
        const initialState = await dataService.loadInitialAnkiState();
        this.setState(initialState);
        await this.updateReviewCount();
        if(initialState.currentSessionId) {
            await this.updatePreview();
        }
    }
    

    // --- 文件与目录管理 Actions ---
    async createFile() {
        const fileName = prompt("请输入新文件的名称：", "新笔记");
        if (!fileName || !fileName.trim()) return;
    
        try {
            const newFile = await dataService.anki_addFile(fileName.trim(), INITIAL_ANKI_CONTENT, this.state.currentFolderId);
            this.setState({ sessions: [...this.state.sessions, newFile] });
            await this.navigateToFile(newFile.id);
        } catch (error) {
            console.error("Failed to create file:", error);
            alert("创建文件失败，请重试。");
        }
    }
    
    async createFolder() {
        const folderName = prompt("请输入新目录的名称：", "新目录");
        if (!folderName || !folderName.trim()) return;

        const newFolder = await dataService.anki_addFolder(folderName.trim(), this.state.currentFolderId);
        this.setState({ folders: [...this.state.folders, newFolder] });
    }

    async deleteSelectedItems() {
        const { selectedItemIds } = this.state;
        if (selectedItemIds.size === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedItemIds.size} 个项目吗？`)) return;

        const { remainingSessions, remainingFolders, remainingClozeStates } = await dataService.anki_removeItems(Array.from(selectedItemIds));
        
        const newState = {
            sessions: remainingSessions,
            folders: remainingFolders,
            clozeStates: remainingClozeStates,
            selectedItemIds: new Set()
        };
        
        // 如果当前文件被删除，导航到第一个文件
        if (selectedItemIds.has(this.state.currentSessionId)) {
            const nextSessionId = remainingSessions.length > 0 ? remainingSessions[0].id : null;
            await this.navigateToFile(nextSessionId);
        }

        this.setState(newState);
        await this.updateReviewCount();
    }

    async moveSelectedItems(targetFolderId) {
        const itemsToMove = Array.from(this.state.selectedItemIds);
        if (itemsToMove.length === 0) return;

        const { updatedSessions, updatedFolders } = await dataService.anki_moveItems(itemsToMove, targetFolderId);
        this.setState({
            sessions: updatedSessions,
            folders: updatedFolders,
            isMoveModalVisible: false,
            selectedItemIds: new Set()
        });
    }

    /**
     * [NEW] Action: 从文件系统导入一个或多个文件
     * @param {File[]} files - 从 <input type="file"> 获取的 File 对象数组
     */
    async importFiles(files) {
        if (!files || files.length === 0) return;

        const readFile = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve({ name: file.name, content: event.target.result });
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });

        try {
            const allFilesData = await Promise.all(Array.from(files).map(readFile));
            const newSessions = [];

            for (const fileData of allFilesData) {
                const nameWithoutExt = fileData.name.lastIndexOf('.') > 0 
                    ? fileData.name.substring(0, fileData.name.lastIndexOf('.'))
                    : fileData.name;
                
                const newFile = await dataService.anki_addFile(nameWithoutExt, fileData.content, this.state.currentFolderId);
                newSessions.push(newFile);
            }

            this.setState({ sessions: [...this.state.sessions, ...newSessions] });

            // 导航到最后一个导入的文件
            if (newSessions.length > 0) {
                await this.navigateToFile(newSessions[newSessions.length - 1].id);
            }
        } catch (error) {
            console.error("文件导入失败:", error);
            alert("读取文件时发生错误。");
        }
    }

    async renameItem(itemId, itemType) {
        const items = itemType === 'file' ? this.state.sessions : this.state.folders;
        const item = items.find(i => i.id === itemId);
        if (!item) return;

        const newName = prompt('输入新名称:', item.name);
        if (!newName || newName.trim() === item.name) return;
        
        const updatedItem = await dataService.anki_updateItemName(itemId, newName.trim(), itemType);
        const updatedCollection = items.map(i => i.id === itemId ? updatedItem : i);

        this.setState(itemType === 'file' ? { sessions: updatedCollection } : { folders: updatedCollection });
    }

    async navigateToFile(fileId) {
        if (this.state.isNavigating || this.state.currentSessionId === fileId) return;
        this.setState({ isNavigating: true });
    
        try {
            if (this.state.currentSessionId) {
                await this.saveCurrentSession();
            }
        
            const session = this.state.sessions.find(s => s.id === fileId);
            if (!session) {
                this.setState({
                    currentSessionId: null, editorContent: '', previewContent: '',
                    viewMode: 'preview', isNavigating: false
                });
                return;
            }
        
            this.setState({
                currentSessionId: fileId, editorContent: session.content || '',
                viewMode: 'preview', expandedHeadingIds: new Set()
            });
        
            await this.updatePreview();
        } catch (error) {
            console.error("Navigation failed:", error);
        } finally {
            this.setState({ isNavigating: false });
        }
    }
    
    async goToFolder(folderId) {
        const { newCurrentFolderId, newFolderStack } = dataService.getFolderNavigationState(this.state.folderStack, this.state.currentFolderId, folderId);
        this.setState({
            currentFolderId: newCurrentFolderId, folderStack: newFolderStack,
            currentSessionId: null, editorContent: '', previewContent: ''
        });
    }
    /** Action: 返回上一级目录 */
    goBack() {
        const stack = [...this.state.folderStack];
        // 弹出最后一个元素作为新的当前目录ID (如果栈为空则为 null)
        const parentId = stack.pop() || null; 
        
        this.setState({ 
            currentFolderId: parentId, folderStack: stack,
            currentSessionId: null, editorContent: '', previewContent: ''
        });
    }

    goToRoot() { this.setState({ currentFolderId: null, folderStack: [] }); }
    // --- 选择与UI交互 Actions ---
    toggleItemSelection(itemId, isShiftClick) {
        const newSelectedIds = new Set(this.state.selectedItemIds);
        const allItems = [...this.state.folders, ...this.state.sessions].filter(i => i.folderId === this.state.currentFolderId);
        
        if (isShiftClick && this._lastToggledItemId) {
            const lastIdx = allItems.findIndex(i => i.id === this._lastToggledItemId);
            const currentIdx = allItems.findIndex(i => i.id === itemId);
            if (lastIdx !== -1 && currentIdx !== -1) {
                const start = Math.min(lastIdx, currentIdx);
                const end = Math.max(lastIdx, currentIdx);
                for (let i = start; i <= end; i++) {
                    newSelectedIds.add(allItems[i].id);
                }
            }
        } else {
            if (newSelectedIds.has(itemId)) newSelectedIds.delete(itemId);
            else newSelectedIds.add(itemId);
        }
        
        this._lastToggledItemId = itemId;
        this.setState({ selectedItemIds: newSelectedIds });
    }
    
    selectAllItems() {
        const allVisibleIds = [...this.state.folders, ...this.state.sessions]
            .filter(i => i.folderId === this.state.currentFolderId)
            .map(i => i.id);
        this.setState({ selectedItemIds: new Set(allVisibleIds) });
    }
    
    deselectAllItems() {
        this.setState({ selectedItemIds: new Set() });
    }

    toggleSidebar() {
        this.setState({ isSidebarVisible: !this.state.isSidebarVisible });
    }

    /**
     * [NEW] Action: 设置编辑器/预览的滚动同步比例
     * @param {number} ratio - 0到1之间的小数
     */
    setScrollRatio(ratio) {
        if (typeof ratio === 'number' && ratio >= 0 && ratio <= 1) {
            this.setState({ editorScrollRatio: ratio });
        }
    }

    // --- 编辑器 Actions ---
    recordUndoState(content) {
        const { undoStack } = this.state;
        // 避免重复记录相同的状态
        if (undoStack[undoStack.length - 1] === content) return;

        const newUndoStack = [...undoStack, content];
        if (newUndoStack.length > MAX_UNDO_HISTORY) {
            newUndoStack.shift();
        }
        this.setState({ undoStack: newUndoStack, redoStack: [] });
    }

    undo() {
        const { undoStack, editorContent } = this.state;
        if (undoStack.length === 0) return;

        const newUndoStack = [...undoStack];
        const lastState = newUndoStack.pop();

        this.setState({
            undoStack: newUndoStack,
            redoStack: [editorContent, ...this.state.redoStack],
            editorContent: lastState
        });
        this.updatePreview();
    }

    redo() {
        const { redoStack, editorContent } = this.state;
        if (redoStack.length === 0) return;
        
        const newRedoStack = [...redoStack];
        const nextState = newRedoStack.shift();

        this.setState({
            undoStack: [...this.state.undoStack, editorContent],
            redoStack: newRedoStack,
            editorContent: nextState
        });
        this.updatePreview();
    }

    // [新增] Action: 更新预览区中用户选择的文本
    setPreviewSelection(text) {
        const hasSelection = !!(text && text.trim().length > 0);
        this.setState({
            previewSelection: {
                text: hasSelection ? text.trim() : '',
                hasSelection,
                timestamp: Date.now()
            }
        });
    }
    
    /**
     * Action: 从预览区发起请求，在编辑器中选中特定文本。
     * @param {string} text - The text to be selected in the editor.
     */
    selectTextInEditor(text) {
        if (!text) return;
        
        this.setState({ 
            pendingEditorSelection: text,
            viewMode: 'edit' 
        });
        
        setTimeout(() => {
            if (this.state.pendingEditorSelection === text) {
                this.setState({ pendingEditorSelection: null });
            }
        }, 100);
    }

    /**
     * [NEW] Action: 在编辑器中包裹选中的文本
     * @param {{prefix: string, suffix?: string, selectionStart: number, selectionEnd: number}} options
     */
    wrapEditorSelection({ prefix, suffix = prefix, selectionStart, selectionEnd }) {
        const { editorContent } = this.state;
        const selectedText = editorContent.substring(selectionStart, selectionEnd);
        const newText = `${prefix}${selectedText}${suffix}`;
        
        const newContent = editorContent.substring(0, selectionStart) + newText + editorContent.substring(selectionEnd);
        
        this.recordUndoState(editorContent); // 记录撤销状态
        this.setState({ editorContent: newContent });
        this.updatePreview();
    }

    /**
     * [REFACTORED] 智能创建或更新Cloze。
     * 根据编辑器中的选区，处理新建、扩展、合并Cloze的复杂逻辑。
     * @param {{selectionStart: number, selectionEnd: number}} selection
     */
    createOrUpdateClozeFromSelection({ selectionStart, selectionEnd }) {
        const { editorContent } = this.state;
        
        const clozeRegex = /--.*?--/gd;
        const existingClozes = [...editorContent.matchAll(clozeRegex)].map(match => ({
            start: match.indices[0][0], end: match.indices[0][1], content: match[0]
        }));

        for (const cloze of existingClozes) {
            if (selectionStart >= cloze.start + 2 && selectionEnd <= cloze.end - 2) {
                return;
            }
        }

        let modificationStart = selectionStart;
        let modificationEnd = selectionEnd;
        
        for (const cloze of existingClozes) {
            const isOverlapping = cloze.start < modificationEnd && cloze.end > modificationStart;
            const gapBefore = editorContent.substring(cloze.end, modificationStart);
            const isAdjacentBefore = gapBefore.trim() === '' && gapBefore.length >= 0;
            const gapAfter = editorContent.substring(modificationEnd, cloze.start);
            const isAdjacentAfter = gapAfter.trim() === '' && gapAfter.length >= 0;

            if (isOverlapping || isAdjacentBefore || isAdjacentAfter) {
                modificationStart = Math.min(modificationStart, cloze.start);
                modificationEnd = Math.max(modificationEnd, cloze.end);
            }
        }

        const contentToWrap = editorContent.substring(modificationStart, modificationEnd);
        const cleanedContent = contentToWrap.replace(/--/g, '');
        const locator = `c${Date.now()}`;
        const newClozeText = `--[${locator}] ${cleanedContent}--`;
        const finalContent = editorContent.substring(0, modificationStart) + newClozeText + editorContent.substring(modificationEnd);

        this.recordUndoState(editorContent);
        this.setState({ editorContent: finalContent });
        this.updatePreview();
    }

    insertCloze({ selectionStart, selectionEnd }) {
        // [DEPRECATED in favor of createOrUpdateClozeFromSelection]
        // Calling the new, more intelligent function as a wrapper.
        this.createOrUpdateClozeFromSelection({ selectionStart, selectionEnd });
    }
    
    /**
     * [NEW] Action: 在编辑器中插入带音频提示的Cloze标记
     * @param {{selectionStart: number, selectionEnd: number}} options
     */
    insertAudioPrompt({ selectionStart, selectionEnd }) {
        const { editorContent } = this.state;
        const selectedText = editorContent.substring(selectionStart, selectionEnd);
        // 提示用户输入音频文本，此处的 'TEXT' 是占位符
        const newAudioText = prompt("请输入Cloze的音频提示文本:", selectedText);
        if (newAudioText === null) return; // 用户取消

        const newText = `--${selectedText}--^^audio:${newAudioText.trim()}^^`;
        const newContent = editorContent.substring(0, selectionStart) + newText + editorContent.substring(selectionEnd);
        
        this.recordUndoState(editorContent);
        this.setState({ editorContent: newContent });
        this.updatePreview();
    }

    // --- 预览与 Cloze Actions ---
    async rateCloze(clozeId, rating) {
        const { clozeStates } = this.state;
        const currentState = clozeStates[clozeId];
        if (!currentState) return;

        const updates = calculateNextReview(currentState, rating);
        // [修复] 在更新状态的同时，将临时可见性设置为false，以便在评分后自动隐藏
        const newState = { ...currentState, ...updates, lastReview: Date.now(), tempVisible: false };

        const newClozeStates = { ...clozeStates, [clozeId]: newState };
        this.setState({ clozeStates: newClozeStates });
        
        await dataService.anki_updateClozeState(newState);
        await this.updateReviewCount();
    }
    
    toggleClozeVisibility(clozeId) {
        const { clozeStates } = this.state;
        const cloze = clozeStates[clozeId];
        
        // 如果 cloze 不存在，直接返回，避免错误。
        // _doUpdatePreview 的修复将确保新的 cloze 在点击前被添加到 state 中。
        if (!cloze) {
            console.warn(`Cloze with id "${clozeId}" not found in state. Preview might be out of sync.`);
            return;
        }

        const updatedCloze = { ...cloze, tempVisible: !cloze.tempVisible };
        this.setState({
            clozeStates: { ...clozeStates, [clozeId]: updatedCloze }
        });
    }

    toggleAllClozesVisibility() {
        this.setState({ areAllClozesVisible: !this.state.areAllClozesVisible });
    }
    
    invertAllClozesVisibility() {
        const { clozeStates, areAllClozesVisible } = this.state;
        const newClozeStates = { ...clozeStates };
        let allVisibleAfterInvert = true;

        Object.keys(newClozeStates).forEach(id => {
            if (newClozeStates[id].fileId === this.state.currentSessionId) {
                // 如果全局是“全显示”模式，则双击隐藏；否则，双击显示
                newClozeStates[id].tempVisible = areAllClozesVisible ? false : !newClozeStates[id].tempVisible;
                if (!newClozeStates[id].tempVisible) {
                    allVisibleAfterInvert = false;
                }
            }
        });

        this.setState({ 
            clozeStates: newClozeStates,
            areAllClozesVisible: allVisibleAfterInvert
        });
    }
    
    /**
     * [NEW] Action: 记录用户交互的Cloze，用于后续导航
     * @param {string} clozeId 
     */
    recordClozeInteraction(clozeId) {
        this.setState({ lastInteractedClozeId: clozeId });
    }

      /**
     * [REFACTORED] Action: 导航到上一个或下一个隐藏的Cloze。
     * 现在使用 state 中预先存好的、顺序可靠的 cloze ID 列表。
     * @param {number} direction - -1 for previous, 1 for next
     */
    navigateToCloze(direction) {
        const previewEl = document.getElementById('anki_preview');
        if (!previewEl) return;

        const { scrollTop, clientHeight } = previewEl;
        
        // 1. 获取所有隐藏的 cloze 元素，以及在当前页面可视的 cloze 元素
        const allHiddenClozes = Array.from(previewEl.querySelectorAll('.cloze.hidden'));
        const hiddenClozesOnPage = allHiddenClozes.filter(el => {
            const elTop = el.offsetTop;
            const elBottom = elTop + el.offsetHeight;
            // 检查元素是否与当前视口有重叠
            return Math.max(elTop, scrollTop) < Math.min(elBottom, scrollTop + clientHeight);
        });

        // 规则: "如果当前页面没有关闭的cloze,那么仅一次翻页"
        if (hiddenClozesOnPage.length === 0) {
            this.performPageTurn(direction, previewEl, false); // <--- 关键修正点
            return;
        }

        // 2. 确定当前在页面上的索引
        const { lastInteractedClozeId } = this.state;
        let currentIndexOnPage = -1;
        if (lastInteractedClozeId) {
            currentIndexOnPage = hiddenClozesOnPage.findIndex(el => el.dataset.clozeId === lastInteractedClozeId);
        }

        let targetCloze = null;

        // 规则: "如果当前页面没有选中的关闭的cloze..."
        if (currentIndexOnPage === -1) {
            if (direction === 1) { // next
                targetCloze = hiddenClozesOnPage[0]; // "...下一个是从最顶上找第一个"
            } else { // prev
                targetCloze = hiddenClozesOnPage[hiddenClozesOnPage.length - 1]; // "...上一个是页面中最后一个"
            }
        } else {
            // 规则: "如果当前页面有上一个/下一个关闭的cloze, 那么...指向他"
            const nextIndexOnPage = currentIndexOnPage + direction;
            if (nextIndexOnPage >= 0 && nextIndexOnPage < hiddenClozesOnPage.length) {
                targetCloze = hiddenClozesOnPage[nextIndexOnPage];
            }
        }

        // 3. 执行导航或翻页
        if (targetCloze) {
            // 在页面内成功找到目标
            this.highlightCloze(targetCloze.dataset.clozeId);
        } else {
            // 规则: "如果导航到页面最后一个关闭cloze, 那么执行一次翻页"
            // (currentIndexOnPage 越界时触发)
            this.performPageTurn(direction, previewEl, true); // `true` 表示翻页后要寻找 cloze
        }
    }

    /**
     * 辅助函数：高亮一个 cloze 并更新最后交互状态
     * @param {string} clozeId - 要高亮的 cloze ID
     */
    highlightCloze(clozeId) {
        this.setState({
            highlightedClozeId: clozeId,
            lastInteractedClozeId: clozeId
        });
        // 动画结束后清除高亮状态，以便下次可以再次触发
        setTimeout(() => this.setState({ highlightedClozeId: null }), 1500);
    }
    
    /** 
     * 辅助函数：执行翻页逻辑
     * @param {number} direction - 翻页方向 (-1 或 1)
     * @param {HTMLElement} previewEl - 预览区的DOM元素
     * @param {boolean} findClozeAfter - 如果为 true, 翻页后会尝试寻找新页面上的第一个/最后一个 cloze
     */
    performPageTurn(direction, previewEl, findClozeAfter = false) {
        const { scrollTop, clientHeight, scrollHeight } = previewEl;
        const tolerance = 1; // 1px 容差，防止因四舍五入导致判断失败

        if (direction === 1) { // 向下翻页
            // 检查是否已在或超过底部
            if (scrollTop + clientHeight >= scrollHeight - tolerance) {
                alert('已到文件结尾');
                previewEl.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            previewEl.scrollTo({ top: scrollTop + clientHeight, behavior: 'smooth' });
        } else { // 向上翻页
            // 检查是否已在或非常接近顶部
            if (scrollTop <= tolerance) {
                alert('已到文件顶部');
                // 滚动回文件底部
                previewEl.scrollTo({ top: scrollHeight, behavior: 'smooth' });
                return;
            }
            previewEl.scrollTo({ top: Math.max(0, scrollTop - clientHeight), behavior: 'smooth' });
        }
        
        if (findClozeAfter) {
            // 等待滚动动画（约300ms）结束后，再在新页面上寻找目标
            setTimeout(() => {
                const newPageTop = previewEl.scrollTop;
                const newPageBottom = newPageTop + previewEl.clientHeight;
                const allHidden = Array.from(previewEl.querySelectorAll('.cloze.hidden'));

                let targetCloze = null;
                if (direction === 1) { // 翻到下一页，找新页面上的第一个
                    targetCloze = allHidden.find(el => el.offsetTop >= newPageTop);
                } else { // 翻到上一页，找新页面上的最后一个
                    targetCloze = allHidden.filter(el => el.offsetTop < newPageBottom).pop();
                }

                if (targetCloze) {
                    this.highlightCloze(targetCloze.dataset.clozeId);
                }
            }, 350); // 给予滚动动画足够的时间
        }
    }

    // --- 复习/SRS Actions ---
    async updateReviewCount() {
        const count = await dataService.anki_getTodaysTotalCount();
        this.setState({ reviewCount: count });
    }

    async startReviewSession(filters) {
        const dueClozes = await dataService.anki_getDueClozes(filters);
        if (dueClozes.length === 0) {
            alert("太棒了！当前范围内没有需要复习的卡片。");
            return;
        }

        this.setState({ 
            reviewQueue: dueClozes,
            currentReviewIndex: 0,
            isCustomStudyModalVisible: false,
        });

        await this.showNextReviewCard();
    }
    
    async showNextReviewCard() {
        const { reviewQueue, currentReviewIndex } = this.state;
        if (currentReviewIndex >= reviewQueue.length) {
            alert("复习会话结束！");
            this.setState({ reviewQueue: [], currentReviewIndex: -1 });
            return;
        }

        const cardToReview = reviewQueue[currentReviewIndex];
        
        if (this.state.currentSessionId !== cardToReview.fileId) {
            await this.navigateToFile(cardToReview.fileId);
        } else {
            this.setViewMode('preview');
        }
    }

    moveToNextCardInSession() {
        this.setState({ currentReviewIndex: this.state.currentReviewIndex + 1 });
        this.showNextReviewCard();
    }
    
    // --- 模态框 Actions ---
    showMoveModal() { this.setState({ isMoveModalVisible: true }); }
    showCustomStudyModal() { this.setState({ isCustomStudyModalVisible: true }); }
    showStatsModal() { this.setState({ isStatsModalVisible: true }); }
    hideAllModals() {
        this.setState({
            isMoveModalVisible: false,
            isCustomStudyModalVisible: false,
            isStatsModalVisible: false
        });
    }

    /**
     * [NEW] Action: 切换侧边栏中H1标题的展开/折叠状态
     * @param {string} headingId - H1标题的唯一ID
     */
    toggleHeadingExpansion(headingId) {
        const newSet = new Set(this.state.expandedHeadingIds);
        if (newSet.has(headingId)) newSet.delete(headingId);
        else newSet.add(headingId);
        this.setState({ expandedHeadingIds: newSet });
    }

    async navigateToHeading(headingId, fileId) {
        // 检查目标文件是否已经是当前文件
        if (this.state.currentSessionId !== fileId) {
            // 如果不是，则调用 navigateToFile 并等待它完成。
            // navigateToFile 内部会处理保存旧文件、加载新文件和 updatePreview()
            await this.navigateToFile(fileId);
        }

        // --- 关键逻辑 ---
        // 到达这一步时，我们能确保两件事：
        // 1. 正确的文件内容已经加载到 state 中。
        // 2. await this.updatePreview() 已经执行完毕，预览区的 DOM 已经更新。
        
        // 现在，可以安全地设置 highlightedHeadingId 来触发滚动了
        this.setState({ highlightedHeadingId: headingId });
        // 短暂延迟后清除ID，以便可以重复点击同一个标题
        setTimeout(() => {
            if (this.state.highlightedHeadingId === headingId) {
                this.setState({ highlightedHeadingId: null });
            }
        }, 1500); // 增加延迟以确保动画效果可见
    }

  
    /** Action: 保存当前会话内容 */
    async saveCurrentSession() {
        const { currentSessionId, editorContent, sessions } = this.state;
        if (this.state.isSaving || !currentSessionId) return;
        
        this.setState({ isSaving: true });

        try {
            // [修复] 调用 dataService 中的 saveSession
            const { subsessions: newSubsessions } = await dataService.saveSession(currentSessionId, editorContent);
            
            // 乐观更新：立即更新UI状态
            const updatedSessions = sessions.map(s =>
                s.id === currentSessionId ? { ...s, content: editorContent } : s
            );
            
            // 同时更新 sessions 和 fileSubsessions 状态
            this.setState({ 
                sessions: updatedSessions,
                fileSubsessions: {
                    ...this.state.fileSubsessions,
                    [currentSessionId]: newSubsessions
                }
            });
        } catch (error) {
            console.error("Failed to save session:", error);
            // 可以在此处添加错误处理和状态回滚逻辑
        } finally {
            this.setState({ isSaving: false });
        }
    }
  
    /** Action: 更新预览内容 */
    async updatePreview() {
        // 如果已有更新正在进行，则等待该更新完成
        if (this.state.isUpdatingPreview) {
            return this.currentUpdatePromise;
        }
      
        this.setState({ isUpdatingPreview: true });
        
        // 创建一个新的Promise来跟踪本次更新
        this.currentUpdatePromise = this._doUpdatePreview();
      
        try {
            await this.currentUpdatePromise;
        } catch (error) {
            console.error("Preview update failed:", error);
        } finally {
            this.setState({ isUpdatingPreview: false });
            this.currentUpdatePromise = null;
        }
    }
  
    async _doUpdatePreview() {
        const { editorContent, currentSessionId, clozeStates } = this.state;
    
        const previewElement = document.getElementById('anki_preview');
        if (!previewElement) {
            console.error("Preview element not found in DOM.");
            return;
        }

        if (!currentSessionId) {
            this.setState({ 
                previewContent: '', 
                clozeStates: {},
                // [ADDED] Clear the order array when no file is selected.
                clozeOrderInCurrentFile: [] 
            });
            previewElement.innerHTML = '<div class="empty-preview"><p>请选择一个文件</p></div>';
            return;
        }
    
        try {
            // --- 核心修正 ---
            // 直接调用 RichContentRenderer.render 来处理所有渲染逻辑
            await RichContentRenderer.render(previewElement, editorContent, {
                fileId: currentSessionId,
                clozeStates: clozeStates,
            });
            
            // RichContentRenderer 已经更新了 DOM，我们现在需要同步 store 的状态
            // （注意：这个简化模型下，我们假设 clozeStates 等由 RichContentRenderer 内部处理，
            //  但在您的原始代码中，processCloze 返回了新发现的 clozes，这里我们需要模拟一下）

            // 解析标题结构以更新侧边栏
            const newSubsessions = parseAndStructureHeadings(editorContent || '');
            
            // 为了保持 Cloze 状态同步，我们可以在这里重新扫描 previewElement 来发现 cloze
            const discoveredClozes = new Map();
            const orderedClozeIds = [];
            previewElement.querySelectorAll('.cloze[data-cloze-id]').forEach(el => {
                const clozeId = el.dataset.clozeId;
                orderedClozeIds.push(clozeId);
                if (!clozeStates[clozeId]) {
                    // 这是一个简化的发现逻辑，实际应用中可能需要更复杂的状态对象
                    discoveredClozes.set(clozeId, { 
                        id: clozeId, fileId: currentSessionId, state: 'new', due: Date.now(), tempVisible: false 
                    });
                }
            });

            // [NEW] 同步状态：将新发现的 cloze 添加到 state.clozeStates
            const newClozeStates = { ...clozeStates };
            let hasNewClozes = false;
            for (const [id, state] of discoveredClozes.entries()) {
                // 只添加当前 state 中不存在的 cloze，以避免覆盖用户交互（如 tempVisible）
                if (!newClozeStates[id]) { 
                    newClozeStates[id] = state;
                    hasNewClozes = true;
                }
            }
            
            const finalStateUpdate = { 
                // 我们不再直接在 store 中存储 previewContent 的 HTML 字符串
                // 而是让 RichContentRenderer 直接操作 DOM
                previewContent: previewElement.innerHTML, // 可以选择性地存储结果
                fileSubsessions: { ...this.state.fileSubsessions, [currentSessionId]: newSubsessions },
                // [ADDED] Update the state with the new, correctly ordered list of cloze IDs.
                clozeOrderInCurrentFile: orderedClozeIds
            };

            if (hasNewClozes) {
                finalStateUpdate.clozeStates = newClozeStates;
            }
    
            this.setState(finalStateUpdate);

        } catch (error) {
          console.error("Preview rendering failed:", error);
          this.setState({ previewContent: '<p>预览渲染失败</p>' });
        }
    }
  
    /** Action: 切换视图模式 ('edit' | 'preview') */
    setViewMode(mode) {
        if (mode === this.state.viewMode) return;
      
        if (mode === 'preview') {
            // 切换到预览前，确保内容是最新的
            this.updatePreview().then(() => {
                this.setState({ viewMode: mode });
            });
        } else {
            this.setState({ viewMode: mode });
        }
    }

    debugState() {
        console.log("Current Anki State:", {
            currentSessionId: this.state.currentSessionId,
            sessionsCount: this.state.sessions.length,
            editorContent: this.state.editorContent?.substring(0, 100) + "...",
            previewContent: this.state.previewContent?.substring(0, 100) + "...",
            viewMode: this.state.viewMode
        });
    }
}

// 导出Store的单例
export const ankiStore = new AnkiStore();
