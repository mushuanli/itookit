/**
 * @fileoverview MemoryPlugin V2 - 直接使用 VFSManager 的 SRSProvider
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('@itookit/vfs-manager').VFSManager} VFSManager */

/**
 * @typedef {object} ClozeMetadata
 * @property {string} id
 * @property {string} status
 * @property {Date|string} dueAt
 * @property {number} interval
 * @property {number} easeFactor
 * @property {number} reviewCount
 */

/**
 * @typedef {object} VFSReadMetadata
 * @property {ClozeMetadata[]} [clozes]
 * @property {number} [totalCards]
 * @property {number} [newCards]
 * @property {number} [dueCards]
 */

/**
 * @typedef {object} SRSProviderExtended
 * @property {function(string, 'again'|'hard'|'good'|'easy'): Promise<any>} gradeCard
 * @property {function(string): Promise<void>} resetCard
 */

export class MemoryPluginV2 {
    name = 'feature:memory';
    
    constructor(options = {}) {
        this.gradingTimeout = (options.gradingTimeout || 300) * 1000;
        
        /** @private @type {VFSManager | null} */
        this.vfs = null;
        
        /** @private @type {string | null} */
        this.nodeId = null;
        
        /** @private @type {Map<string, ClozeMetadata>} */
        this.clozeStatesCache = new Map();
        
        /** @private @type {HTMLElement | null} */
        this.activeClozeEl = null;
        
        /** @private @type {number | null} */
        this.gradingTimerId = null;
    }
    
    /**
     * @param {PluginContext} context
     */
    install(context) {
        // 获取 VFSManager 实例（需要在 context 中提供）
        this.vfs = context.getVFSManager();
        this.nodeId = context.getCurrentNodeId();
        
        if (!this.vfs || !this.nodeId) {
            console.warn('[MemoryPlugin] VFSManager or nodeId not available. Plugin disabled.');
            return;
        }
        
        // 监听 DOM 更新
        context.on('domUpdated', ({ element }) => this._syncWithVFS(element));
        
        // 监听单个卡片显示
        context.listen('clozeRevealed', (detail) => this._handleClozeRevealed(detail));
        
        // 监听批量评分模式
        context.listen('clozeBatchGradeToggle', ({ isVisible, editor }) => {
            if (isVisible) {
                this._enterBatchGradingMode(editor.renderEl);
            } else {
                this._dismissAllGradingPanels(editor.renderEl);
            }
        });
        
        // 监听文件保存
        context.on('beforeSave', async () => {
            await this._syncClozeStates();
        });
    }
    
    /**
     * 从 VFS 同步 SRS 状态到本地缓存
     * @param {HTMLElement} element
     */
    async _syncWithVFS(element) {
        try {
            if (!this.vfs || !this.nodeId) return;
            
            // 读取当前文档的元数据
            const { metadata } = await this.vfs.read(this.nodeId);
            
            // 类型断言
            const vfsMetadata = /** @type {VFSReadMetadata} */ (metadata);
            
            // 清空缓存
            this.clozeStatesCache.clear();
            
            // 填充缓存
            if (vfsMetadata.clozes && Array.isArray(vfsMetadata.clozes)) {
                vfsMetadata.clozes.forEach(cloze => {
                    this.clozeStatesCache.set(cloze.id, {
                        id: cloze.id,
                        status: cloze.status,
                        dueAt: new Date(cloze.dueAt),
                        interval: cloze.interval,
                        easeFactor: cloze.easeFactor,
                        reviewCount: cloze.reviewCount
                    });
                });
            }
            
            // 更新 DOM 显示
            const clozeElements = element.querySelectorAll('.cloze[data-cloze-id]');
            clozeElements.forEach(el => {
            const htmlEl = /** @type {HTMLElement} */ (el);
            const clozeId = htmlEl.dataset.clozeId;
                if (clozeId) {
                    const state = this.clozeStatesCache.get(clozeId);
                this._updateClozeVisuals(htmlEl, state);
                }
            });
            
        } catch (error) {
            console.error('[MemoryPlugin] Failed to sync with VFS:', error);
        }
    }
    
    /**
     * 将本地修改同步回 VFS
     */
    async _syncClozeStates() {
        // VFSManager 的 SRSProvider 会在 write 时自动处理
        // 这里不需要手动同步，因为卡片状态已经存储在 VFS 中
    }
    
    /**
     * 评分卡片 - 调用 VFS 的 SRS API
     * @param {string} clozeId
     * @param {'again'|'hard'|'good'|'easy'} rating
     */
    async _gradeCard(clozeId, rating) {
        try {
            if (!this.vfs || !this.nodeId) return;
            
            // 获取 SRSProvider
            const srsProvider = this.vfs.getProvider('srs');
            
            if (!srsProvider) {
                console.warn('[MemoryPlugin] SRS provider not available');
                return;
            }
            
            // 类型断言为扩展接口
            const extendedProvider = /** @type {SRSProviderExtended} */ (/** @type {unknown} */ (srsProvider));
            
            if (!extendedProvider.gradeCard) {
                console.warn('[MemoryPlugin] SRS grading not available');
                return;
            }
            
            // 调用 SRSProvider 的评分方法
            await extendedProvider.gradeCard(clozeId, rating);
            
            // 重新读取更新后的状态
            const { metadata } = await this.vfs.read(this.nodeId);
            const vfsMetadata = /** @type {VFSReadMetadata} */ (metadata);
            const updatedCloze = vfsMetadata.clozes?.find(c => c.id === clozeId);
            
            if (updatedCloze) {
                this.clozeStatesCache.set(clozeId, {
                    id: updatedCloze.id,
                    status: updatedCloze.status,
                    dueAt: new Date(updatedCloze.dueAt),
                    interval: updatedCloze.interval,
                    easeFactor: updatedCloze.easeFactor,
                    reviewCount: updatedCloze.reviewCount
                });
            }
            
        } catch (error) {
            console.error('[MemoryPlugin] Failed to grade card:', error);
            throw error;
        }
    }
    
    /**
     * 重置卡片
     * @param {string} clozeId
     */
    async _resetCard(clozeId) {
        try {
            if (!this.vfs) return;
            
            const srsProvider = this.vfs.getProvider('srs');
            if (!srsProvider) return;
            
            // 类型断言
            const extendedProvider = /** @type {SRSProviderExtended} */ (/** @type {unknown} */ (srsProvider));
            
            if (extendedProvider.resetCard) {
                await extendedProvider.resetCard(clozeId);
                await this._syncWithVFS(document.body);
            }
        } catch (error) {
            console.error('[MemoryPlugin] Failed to reset card:', error);
        }
    }
    
    /**
     * 处理卡片评分
     */
    async _gradeAndApply(clozeEl, rating) {
        const clozeId = clozeEl.dataset.clozeId;
        
        await this._gradeCard(clozeId, rating);
        
        // 移除评分面板
        const panel = clozeEl.nextElementSibling;
        if (panel && panel.classList.contains('mdx-memory-grading-panel')) {
            panel.remove();
        }
        
        // 更新显示
        const state = this.clozeStatesCache.get(clozeId);
        this._updateClozeVisuals(clozeEl, state);
    }
    
    /**
     * 处理成熟卡片双击重置
     */
    async _handleMatureDoubleClick(element, event) {
        event.preventDefault();
        event.stopPropagation();
        
        const clozeId = element.dataset.clozeId;
        await this._resetCard(clozeId);
        
        const state = this.clozeStatesCache.get(clozeId);
        this._updateClozeVisuals(element, state);
    }
    
    /**
     * 更新卡片视觉效果
     */
    _updateClozeVisuals(element, state) {
        const elWithCustomProps = /** @type {any} */ (element);
        elWithCustomProps.clozeState = state;
        
        element.classList.remove('is-mature', 'is-learning', 'is-review');
        element.dataset.memoryTier = state?.status || 'new';
        
        if (elWithCustomProps._boundHandleMatureDoubleClick) {
            element.removeEventListener('dblclick', elWithCustomProps._boundHandleMatureDoubleClick);
            elWithCustomProps._boundHandleMatureDoubleClick = null;
        }
        
        if (!state) {
            element.classList.add('hidden');
            return;
        }
        
        const now = new Date();
        const isDue = state.dueAt && new Date(state.dueAt) <= now;
        const isMature = state.status === 'review' && state.interval >= 21;
        
        if (isMature) {
            element.classList.add('is-mature');
            element.classList.remove('hidden');
            
            const boundListener = this._handleMatureDoubleClick.bind(this, element);
            element.addEventListener('dblclick', boundListener);
            elWithCustomProps._boundHandleMatureDoubleClick = boundListener;
        } else if (isDue) {
            element.classList.remove('hidden');
            if (state.status === 'learning') {
                element.classList.add('is-learning');
            } else if (state.status === 'review') {
                element.classList.add('is-review');
            }
        } else {
            element.classList.add('hidden');
        }
    }
    
    _handleClozeRevealed({ element }) {
        this._dismissAllGradingPanels(element.ownerDocument.body);
        this.activeClozeEl = element;
        this._createGradingPanel(element, true);
    }
    
    _dismissAllGradingPanels(element) {
        element.querySelectorAll('.mdx-memory-grading-panel').forEach(panel => panel.remove());
        if (this.gradingTimerId) {
            clearTimeout(this.gradingTimerId);
            this.gradingTimerId = null;
        }
        this.activeClozeEl = null;
    }
    
    _enterBatchGradingMode(element) {
        this._dismissAllGradingPanels(element);
        
        const clozeElements = element.querySelectorAll('.cloze[data-cloze-id]');
        clozeElements.forEach(clozeEl => {
            const state = this.clozeStatesCache.get(clozeEl.dataset.clozeId);
            const isMature = state && state.status === 'review' && state.interval >= 21;
            
            if (!isMature) {
                this._createGradingPanel(clozeEl, false);
            }
        });
    }
    
    _createGradingPanel(clozeEl, applyTimeout) {
        const gradingPanel = document.createElement('div');
        gradingPanel.className = 'mdx-memory-grading-panel';
        
        gradingPanel.innerHTML = `
            <button class="mdx-memory-grade-btn again" data-rating="again">Again</button>
            <button class="mdx-memory-grade-btn hard" data-rating="hard">Hard</button>
            <button class="mdx-memory-grade-btn good" data-rating="good">Good</button>
            <button class="mdx-memory-grade-btn easy" data-rating="easy">Easy</button>
        `;
        
        clozeEl.insertAdjacentElement('afterend', gradingPanel);
        
        if (applyTimeout) {
            this.gradingTimerId = window.setTimeout(() => {
                if (this.activeClozeEl === clozeEl) {
                    this._gradeAndApply(clozeEl, 'good');
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
                const rating = (/** @type {HTMLElement} */ (button)).dataset.rating;
                this._gradeAndApply(clozeEl, rating);
            }
        });
    }
    
    destroy() {
        this._dismissAllGradingPanels(document.body);
        document.querySelectorAll('.cloze').forEach(el => {
            const elWithCustomProps = /** @type {any} */ (el);
            if (elWithCustomProps._boundHandleMatureDoubleClick) {
                el.removeEventListener('dblclick', elWithCustomProps._boundHandleMatureDoubleClick);
                elWithCustomProps._boundHandleMatureDoubleClick = null;
            }
        });
    }
}
