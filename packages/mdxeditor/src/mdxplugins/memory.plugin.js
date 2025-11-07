/**
 * @file mdxeditor/mdxplugins/memory.plugin.js
 * @description The self-contained MemoryPlugin with built-in SRS logic and state management.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */
/** @typedef {import('../core/plugin.js').ScopedPersistenceStore} ScopedPersistenceStore */

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
        
        /** @private @type {ScopedPersistenceStore | null} */
        this.store = null;
        /** @private @type {Map<string, object>} */
        this.states = new Map();
        /** @private @type {boolean} */
        this.isLoaded = false;

        /** @private @type {string} */
        this.todayStr = new Date().toISOString().split('T')[0];
        /** @private @type {Set<string>} */
        this.easyTodayIds = new Set();

        /** @private @type {HTMLElement | null} */
        this.activeClozeEl = null;
        /** @private @type {number | null} */
        this.gradingTimerId = null;
    }

    /**
     * @param {PluginContext} context
     */
    install(context) {
        this.store = context.getScopedStore();

        context.on('domUpdated', ({ element }) => this._applyInitialStates(element));
        context.listen('clozeRevealed', (detail) => this._handleClozeRevealed(detail));
        context.listen('clozeBatchGradeToggle', ({ isVisible, /** @type {MDxEditor} */ editor }) => {
            if (isVisible) {
                this._enterBatchGradingMode(editor.renderEl);
            } else {
                this._dismissAllGradingPanels(editor.renderEl);
            }
        });
    }

    /** @private Loads all states from persistent storage into the in-memory cache. */
    async _loadStates() {
        if (this.isLoaded || !this.store) return;
        
        const storedSrsData = await this.store.get('all-srs-states');
        if (storedSrsData) {
            this.states = new Map(storedSrsData);
        }
        
        const easyTodayData = await this.store.get('easy-today-flags');
        if (easyTodayData && easyTodayData.date === this.todayStr) {
            this.easyTodayIds = new Set(easyTodayData.ids);
        } else {
            this.easyTodayIds.clear();
            await this.store.remove('easy-today-flags');
        }

        this.isLoaded = true;
    }

    /** @private Persists the entire SRS state cache to storage. */
    async _persistSrsStates() {
        if (!this.store) return;
        // Ensure dueDate is stored in a serializable format (ISO string)
        const serializableStates = Array.from(this.states.entries()).map(([key, state]) => {
            if (state.dueDate instanceof Date) {
                return [key, { ...state, dueDate: state.dueDate.toISOString() }];
            }
            return [key, state];
        });
        await this.store.set('all-srs-states', serializableStates);
    }
    
    /** @private Persists the "easy today" flags. */
    async _persistEasyTodayFlags() {
        if (!this.store) return;
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
        this._dismissAllGradingPanels(element); 

        const clozeElements = Array.from(element.querySelectorAll('.cloze[data-cloze-id]'));
        if (clozeElements.length === 0) return;

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
        const clozeId = clozeEl.dataset.clozeId;
        const currentState = clozeEl.clozeState || null;

        const newState = this._grade(clozeId, currentState, rating);
        this.states.set(clozeId, newState);
        await this._persistSrsStates();
        
        if (rating === 'easy') {
            this.easyTodayIds.add(clozeId);
            await this._persistEasyTodayFlags();
        } else {
            if (this.easyTodayIds.has(clozeId)) {
                this.easyTodayIds.delete(clozeId);
                await this._persistEasyTodayFlags();
            }
        }
        
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
        await this._persistSrsStates();

        if (this.easyTodayIds.has(clozeId)) {
            this.easyTodayIds.delete(clozeId);
            await this._persistEasyTodayFlags();
        }

        this._updateClozeVisuals(element, newState);
    }

    /** @private Handles single cloze reveal, ensuring other panels are dismissed */
    _handleClozeRevealed({ element }) {
        this._dismissAllGradingPanels(element.ownerDocument.body);
        
        this.activeClozeEl = element;
        this._createGradingPanel(element, true); // Pass true to enable auto-grade timeout
    }

    /** @private Central method to remove all grading panels from a given root element. */
    _dismissAllGradingPanels(element) {
        element.querySelectorAll('.mdx-memory-grading-panel').forEach(panel => panel.remove());
        if (this.gradingTimerId) {
            clearTimeout(this.gradingTimerId);
            this.gradingTimerId = null;
        }
        this.activeClozeEl = null;
    }

    /** @private Logic to enter batch grading mode */
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

    /** @private Pure factory for creating a self-contained grading panel */
    _createGradingPanel(clozeEl, applyTimeout) {
        const gradingPanel = document.createElement('div');
        gradingPanel.className = 'mdx-memory-grading-panel';
        
        gradingPanel.innerHTML = `
            <button class="mdx-memory-grade-btn again" data-rating="again" title="Forgot, review in 1 day">Again</button>
            <button class="mdx-memory-grade-btn hard" data-rating="hard" title="Recalled with difficulty">Hard</button>
            <button class="mdx-memory-grade-btn hesitant" data-rating="hesitant" title="Recalled with some hesitation">Hesitant</button>
            <button class="mdx-memory-grade-btn easy" data-rating="easy" title="Recalled instantly">Easy</button>
        `;

        clozeEl.insertAdjacentElement('afterend', gradingPanel);

        if (applyTimeout) {
            this.gradingTimerId = window.setTimeout(() => {
                if (this.activeClozeEl === clozeEl) {
                    this._gradeAndApply(clozeEl, 'hesitant');
                }
            }, this.gradingTimeout);
        }

        gradingPanel.addEventListener('click', (e) => {
            const button = (/** @type {Element} */(e.target)).closest('[data-rating]');
            if (button) {
                if (this.gradingTimerId) {
                    window.clearTimeout(this.gradingTimerId);
                    this.gradingTimerId = null;
                }
                // [订正] 将 button 转换为 HTMLElement 以访问 dataset
                const rating = (/** @type {HTMLElement} */ (button)).dataset.rating;
                this._gradeAndApply(clozeEl, rating);
            }
        });
    }

    /** @private */
    _updateClozeVisuals(element, state) {
        // Store state on the element for easy access
        // [订正] 同样，为 element 定义一个 any 类型的别名以方便访问自定义属性
        const elWithCustomProps = /** @type {any} */ (element);
        elWithCustomProps.clozeState = state;
        
        // Remove all previous tier classes
        element.dataset.memoryTier = 'new';
        element.classList.remove('is-mature');
        
        // [订正] 使用 any 类型的别名访问和移除事件监听器
        if (elWithCustomProps._boundHandleMatureDoubleClick) {
            element.removeEventListener('dblclick', elWithCustomProps._boundHandleMatureDoubleClick);
            elWithCustomProps._boundHandleMatureDoubleClick = null;
        }

        const clozeId = element.dataset.clozeId;
        
        if (!state) {
            element.classList.add('hidden');
            return;
        }

        const isMature = state.tier === 'mature';
        const isEasyToday = this.easyTodayIds.has(clozeId);
        
        element.dataset.memoryTier = state.tier;

        const shouldBeVisible = isMature || isEasyToday;

        if (shouldBeVisible) {
            element.classList.remove('hidden');
            if (isMature) {
                element.classList.add('is-mature');
                // Re-bind double click listener for mature cards to reset them
                const boundListener = this._handleMatureDoubleClick.bind(this, element);
                element.addEventListener('dblclick', boundListener);
                // [订正] 使用 any 类型的别名来存储事件监听器引用
                elWithCustomProps._boundHandleMatureDoubleClick = boundListener;
            }
        } else {
            // For any other state, hide it after grading.
            element.classList.add('hidden');
        }
    }

    destroy() {
        this._dismissAllGradingPanels(document.body); // Ensure cleanup on editor destruction
        document.querySelectorAll('.cloze').forEach(el => {
            const elWithCustomProps = /** @type {any} */ (el);
            if (elWithCustomProps._boundHandleMatureDoubleClick) {
                el.removeEventListener('dblclick', elWithCustomProps._boundHandleMatureDoubleClick);
                elWithCustomProps._boundHandleMatureDoubleClick = null;
            }
        });
    }
}
