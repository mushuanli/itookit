/**
 * #mdx/editor/plugins/memory.plugin.js
 * @file [REFACTORED] The self-contained MemoryPlugin with built-in SRS logic and state management.
 */

export class MemoryPlugin {
    name = 'feature:memory';

    /**
     * @param {object} [options]
     * @param {number} [options.matureInterval=21] - The interval (in days) at which a cloze is considered 'mature'.
     * @param {number} [options.gradingTimeout=300] - Timeout in seconds for the grading panel before 'good' is auto-selected.
     */
    constructor(options = {}) {
        this.matureInterval = options.matureInterval || 21;
        this.gradingTimeout = (options.gradingTimeout || 300) * 1000; // convert to ms
        
        /** @private @type {{get: Function, set: Function, remove: Function} | null} The plugin's private, scoped data store, obtained via context */
        this.store = null;
        /** @private @type {Map<string, object>} In-memory cache of all cloze states for performance */
        this.states = new Map();
        /** @private @type {boolean} Flag to ensure states are loaded only once initially */
        this.isLoaded = false;

        // [NEW] 用于存储“今日Easy”状态
        /** @private @type {string} 当前日期字符串，用于判断是否是当天。格式 YYYY-MM-DD */
        this.todayStr = new Date().toISOString().split('T')[0];
        /** @private @type {Set<string>} 存储今天被标记为 'easy' 的 cloze ID */
        this.easyTodayIds = new Set();

        /** @private The cloze element associated with the active single-reveal panel */
        this.activeClozeEl = null;
        /** @private The timeout ID for auto-grading */
        this.gradingTimerId = null;
    }

    install(context) {
        // [NEW CORE LOGIC] Get the private, namespaced data store from the context.
        this.store = context.getScopedStore();

        context.on('domUpdated', ({ element }) => this._applyInitialStates(element));
        context.listen('clozeRevealed', (detail) => this._handleClozeRevealed(detail));

        // +++ START MODIFICATION: 监听批量模式事件 +++
        context.listen('clozeBatchGradeToggle', ({ isVisible, editor }) => {
            if (isVisible) {
                this._enterBatchGradingMode(editor.renderEl);
            } else {
                this._dismissAllGradingPanels(editor.renderEl);
            }
        });
        // +++ END MODIFICATION +++
    }

    /** @private Loads all states from persistent storage into the in-memory cache. */
    async _loadStates() {
        if (this.isLoaded) return;
        
        // 加载完整的 SRS 状态
        const storedSrsData = await this.store.get('all-srs-states');
        if (storedSrsData) {
            this.states = new Map(storedSrsData);
        }
        
        // [NEW] 加载“今日Easy”的状态
        const easyTodayData = await this.store.get('easy-today-flags');
        if (easyTodayData && easyTodayData.date === this.todayStr) {
            this.easyTodayIds = new Set(easyTodayData.ids);
        } else {
            // 如果不是当天，清除旧的“今日Easy”状态
            this.easyTodayIds.clear();
            await this.store.remove('easy-today-flags');
        }

        this.isLoaded = true;
    }

    /** @private Persists the entire SRS state cache to storage. */
    async _persistSrsStates() {
        // Ensure dueDate is stored in a serializable format (ISO string)
        const serializableStates = Array.from(this.states.entries()).map(([key, state]) => {
            if (state.dueDate instanceof Date) {
                return [key, { ...state, dueDate: state.dueDate.toISOString() }];
            }
            return [key, state];
        });
        await this.store.set('all-srs-states', serializableStates);
    }
    
    /** @private [NEW] 持久化“今日Easy”的状态 */
    async _persistEasyTodayFlags() {
        await this.store.set('easy-today-flags', {
            date: this.todayStr,
            ids: Array.from(this.easyTodayIds)
        });
    }

    /** @private The built-in SM-2-like SRS grading algorithm. */
    _grade(clozeId, currentState, rating) {
        const state = currentState || { id: clozeId, tier: 'new', easeFactor: 2.5, interval: 0, repetitions: 0 };
        if (typeof state.dueDate === 'string') state.dueDate = new Date(state.dueDate);

        if (rating === 'again') {
            state.repetitions = 0;
            state.interval = 1;
            state.tier = 'learning';
        } else {
            state.repetitions = (state.repetitions || 0) + 1;
            
            if (rating === 'hard') state.easeFactor = Math.max(1.3, state.easeFactor - 0.15);
            if (rating === 'easy') state.easeFactor += 0.15;
            
            if (state.repetitions <= 1) state.interval = 1;
            else if (state.repetitions === 2) state.interval = 6;
            else state.interval = Math.ceil((state.interval || 1) * state.easeFactor);
            
            state.tier = 'review';
        }
        
        if (state.interval > this.matureInterval) state.tier = 'mature';

        const now = new Date();
        now.setHours(0, 0, 0, 0); // Normalize to the start of the day for consistent scheduling
        state.dueDate = new Date(now.setDate(now.getDate() + state.interval));
        
        return state;
    }
    
    /** @private Generates a fresh state for a cloze. */
    _reset(clozeId) {
        return { id: clozeId, tier: 'new' };
    }

    /** @private */
    async _applyInitialStates(element) {
        // 当内容重绘时，确保清除所有可能残留的评分菜单
        this._dismissAllGradingPanels(element); 

        const clozeElements = Array.from(element.querySelectorAll('.cloze[data-cloze-id]'));
        if (clozeElements.length === 0) return;

        // [MODIFIED] 确保在应用状态前已从持久层加载数据
        await this._loadStates();

        clozeElements.forEach(el => {
            const clozeId = el.dataset.clozeId;
            const state = this.states.get(clozeId) || null;
            if (state && typeof state.dueDate === 'string') state.dueDate = new Date(state.dueDate);
            this._updateClozeVisuals(el, state);
        });
    }

    /** @private */
    async _gradeAndApply(clozeEl, rating) {
        // --- REFACTORED: 不再调用 dismissAll, 而是移除自己的 panel ---
        const clozeId = clozeEl.dataset.clozeId;
        const currentState = clozeEl.clozeState || null;

        const newState = this._grade(clozeId, currentState, rating);
        this.states.set(clozeId, newState);
        await this._persistSrsStates(); // [MODIFIED] 持久化SRS状态
        
        // [NEW] 如果评级为 'easy'，更新“今日Easy”列表并持久化
        if (rating === 'easy') {
            this.easyTodayIds.add(clozeId);
            await this._persistEasyTodayFlags();
        } else {
            // 如果不是 'easy'，确保从“今日Easy”列表中移除 (如果存在)
            if (this.easyTodayIds.has(clozeId)) {
                this.easyTodayIds.delete(clozeId);
                await this._persistEasyTodayFlags();
            }
        }
        
        // 关键：在应用视觉效果之前，先找到并移除这个 cloze 对应的评分菜单
        // 假设菜单是紧随 cloze 的下一个兄弟元素
        const panel = clozeEl.nextElementSibling;
        if (panel && panel.classList.contains('mdx-memory-grading-panel')) {
            panel.remove();
        }
        
        this._updateClozeVisuals(clozeEl, newState);
    }
    
    /** @private */
    async _handleMatureDoubleClick(element, event) {
        event.preventDefault();
        event.stopPropagation();
        
        const clozeId = element.dataset.clozeId;
        const newState = this._reset(clozeId);
        this.states.set(clozeId, newState);
        await this._persistSrsStates(); // [MODIFIED] 持久化SRS状态

        // [NEW] 如果重置了，也从“今日Easy”列表中移除
        if (this.easyTodayIds.has(clozeId)) {
            this.easyTodayIds.delete(clozeId);
            await this._persistEasyTodayFlags();
        }

        this._updateClozeVisuals(element, newState);
    }

    /** @private [REFACTORED] Handles single cloze reveal, ensuring other panels are dismissed */
    _handleClozeRevealed({ element }) {
        this._dismissAllGradingPanels(element.ownerDocument.body);
        
        this.activeClozeEl = element;
        this._createGradingPanel(element, true); // Pass true to enable auto-grade timeout
    }

    /** @private [REFACTORED] Central method to remove all grading panels from a given root element. */
    _dismissAllGradingPanels(element) {
        element.querySelectorAll('.mdx-memory-grading-panel').forEach(panel => panel.remove());
        if (this.gradingTimerId) {
            clearTimeout(this.gradingTimerId);
            this.gradingTimerId = null;
        }
        this.activeClozeEl = null;
    }

    /** @private [NEW] Logic to enter batch grading mode */
    _enterBatchGradingMode(element) {
        this._dismissAllGradingPanels(element); // Ensure a clean start

        const clozeElements = element.querySelectorAll('.cloze[data-cloze-id]');
        clozeElements.forEach(clozeEl => {
            const state = clozeEl.clozeState;
            const isMature = state && state.tier === 'mature';
            const isEasyToday = this.easyTodayIds.has(clozeEl.dataset.clozeId);

            // Only show grading panel for clozes that need review
            if (!isMature && !isEasyToday) {
                this._createGradingPanel(clozeEl, false); // false for no timeout
            }
        });
    }

    /** @private [REFACTORED] Pure factory for creating a self-contained grading panel */
    _createGradingPanel(clozeEl, applyTimeout) {
        const gradingPanel = document.createElement('div');
        gradingPanel.className = 'mdx-memory-grading-panel';
        
        gradingPanel.innerHTML = `
            <button class="mdx-memory-grade-btn again" data-rating="again" title="完全忘记，1天后复习">重来</button>
            <button class="mdx-memory-grade-btn hard" data-rating="hard" title="想起来很困难">困难</button>
            <button class="mdx-memory-grade-btn hesitant" data-rating="hesitant" title="想起来有些犹豫">犹豫</button>
            <button class="mdx-memory-grade-btn easy" data-rating="easy" title="不假思索地想起来">简单</button>
        `;

        clozeEl.insertAdjacentElement('afterend', gradingPanel);

        if (applyTimeout) {
            this.gradingTimerId = setTimeout(() => {
                if (this.activeClozeEl === clozeEl) {
                    this._gradeAndApply(clozeEl, 'hesitant');
                }
            }, this.gradingTimeout);
        }

        gradingPanel.addEventListener('click', (e) => {
            const button = e.target.closest('[data-rating]');
            if (button) {
                if (this.gradingTimerId) {
                    clearTimeout(this.gradingTimerId);
                    this.gradingTimerId = null;
                }
                this._gradeAndApply(clozeEl, button.dataset.rating);
            }
        });
    }

    /** @private */
    _updateClozeVisuals(element, state) {
        // Store state on the element for easy access
        element.clozeState = state;
        
        // Remove all previous tier classes
        element.dataset.memoryTier = 'new';
        element.classList.remove('is-mature');
        
        // [FIXED] Remove previous dblclick listener if it exists, before potentially adding a new one
        if (element._boundHandleMatureDoubleClick) {
            element.removeEventListener('dblclick', element._boundHandleMatureDoubleClick);
            element._boundHandleMatureDoubleClick = null;
        }

        const clozeId = element.dataset.clozeId;
        
        if (!state) {
            // It's a new card, ensure it's hidden
            element.classList.add('hidden');
            return;
        }

        const isMature = state.tier === 'mature';
        const isEasyToday = this.easyTodayIds.has(clozeId);
        
        element.dataset.memoryTier = state.tier;

        // [MODIFIED] 核心需求实现：如果卡片是 'mature' 或者今天被评为 'easy'，则它应该是可见的
        const shouldBeVisible = isMature || isEasyToday;

        if (shouldBeVisible) {
            element.classList.remove('hidden');
            if (isMature) {
                element.classList.add('is-mature');
                // Re-bind double click listener for mature cards to reset them
                const boundListener = this._handleMatureDoubleClick.bind(this, element);
                element.addEventListener('dblclick', boundListener);
                element._boundHandleMatureDoubleClick = boundListener; // Store on element for removal
            }
        } else {
            // For any other state, hide it after grading.
            element.classList.add('hidden');
        }
    }

    destroy() {
        this._dismissAllGradingPanels(document.body); // Ensure cleanup on editor destruction
        document.querySelectorAll('.cloze').forEach(el => {
            if (el._boundHandleMatureDoubleClick) {
                el.removeEventListener('dblclick', el._boundHandleMatureDoubleClick);
                el._boundHandleMatureDoubleClick = null;
            }
        });
    }
}
