/**
 * #mdx/editor/plugins/cloze-controls.plugin.js
 * @file [NEW] Provides floating buttons in the bottom-right corner to control cloze elements in render mode.
 */

import { ClozeAPIKey } from './cloze.plugin.js';

export class ClozeControlsPlugin {
    name = 'feature:cloze-controls';

    constructor() {
        /** @private The main container for the floating buttons */
        this.panelEl = null; // Renamed for clarity
        /** @private Reference to the toggle all button to update its icon/title */
        this.toggleAllBtn = null;
        /** @private Tracks the state of the toggle all button */
        this.isAllOpen = false;
        /** @private Tracks the index for prev/next navigation */
        this.currentHiddenClozeIndex = -1;
        /** @private A cache of currently hidden cloze elements */
        this.hiddenClozesCache = [];
    }

    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        // This hook runs after the editor's main DOM is ready.
        context.on('editorPostInit', ({ editor }) => {
            // The plugin's functionality is controlled by an option on the MDxEditor instance.
            if (!editor.options.clozeControls) {
                return;
            }

            const clozeApiFactory = context.inject(ClozeAPIKey);
            if (!clozeApiFactory) {
                console.warn('[ClozeControlsPlugin] ClozePlugin is required but not found. Controls will not be added.');
                return;
            }

            this.createDOM(editor.container);
            this.attachEventListeners(editor, clozeApiFactory);
        });
        
        // When the rendered content changes, reset the navigation state
        // and also check visibility based on editor mode.
        context.on('domUpdated', ({ editor }) => {
             this.resetNavigationState();
             // +++ START MODIFICATION +++
             if (this.panelEl) {
                // Sync visibility with the current editor mode
                const isInEditMode = editor.mode === 'edit';
                this.panelEl.style.display = isInEditMode ? 'none' : '';
             }
             // +++ END MODIFICATION +++
        });

        // +++ START MODIFICATION +++
        // Listen for mode changes to show/hide the panel immediately
        context.listen('modeChanged', ({ mode }) => {
            if (this.panelEl) {
                const isInEditMode = mode === 'edit';
                this.panelEl.style.display = isInEditMode ? 'none' : '';
            }
        });
        // +++ END MODIFICATION +++
    }

    /** @private */
    createDOM(editorContainer) {
        this.panelEl = document.createElement('div');
        this.panelEl.className = 'mdx-cloze-controls__panel';
        
        // --- Create Buttons with New Structure & Classes ---

        const prevBtn = document.createElement('button');
        prevBtn.className = 'mdx-cloze-controls__btn';
        prevBtn.title = '上一个关闭的 Cloze';
        prevBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';

        this.toggleAllBtn = document.createElement('button');
        this.toggleAllBtn.className = 'mdx-cloze-controls__btn mdx-cloze-controls__btn--accent';
        this.toggleAllBtn.title = '全部展开 (openallcloze)';
        // [MODIFIED] Create nested structure for icon animation
        this.toggleAllBtn.innerHTML = `
            <span class="mdx-cloze-controls__btn-icon">
                <i class="fas fa-eye"></i>
                <i class="fas fa-eye-slash"></i>
            </span>`;

        const reverseBtn = document.createElement('button');
        reverseBtn.className = 'mdx-cloze-controls__btn';
        reverseBtn.title = '反转所有状态 (reverseclozestat)';
        reverseBtn.innerHTML = '<i class="fas fa-retweet"></i>';
        
        const nextBtn = document.createElement('button');
        nextBtn.className = 'mdx-cloze-controls__btn';
        nextBtn.title = '下一个关闭的 Cloze';
        nextBtn.innerHTML = '<i class="fas fa-arrow-down"></i>';

        // [MODIFIED] Append in the requested order: Up, Toggle, Reverse, Down
        this.panelEl.appendChild(prevBtn);
        this.panelEl.appendChild(this.toggleAllBtn);
        this.panelEl.appendChild(reverseBtn);
        this.panelEl.appendChild(nextBtn);

        editorContainer.appendChild(this.panelEl);

        // Store references for event listeners
        this.reverseBtn = reverseBtn;
        this.prevBtn = prevBtn;
        this.nextBtn = nextBtn;
    }

    /** @private */
    attachEventListeners(editor, clozeApiFactory) {
        const clozeApi = clozeApiFactory(editor.renderEl);

        // 1. openallcloze / clozeallcloze
        this.toggleAllBtn.addEventListener('click', () => {
            this.isAllOpen = !this.isAllOpen;
            clozeApi.toggleAll(this.isAllOpen);

            // [MODIFIED] Toggle a class for CSS-driven animation instead of changing innerHTML
            this.toggleAllBtn.classList.toggle('is-all-open', this.isAllOpen);
            
            if (this.isAllOpen) {
                this.toggleAllBtn.title = '全部折叠 (clozeallcloze)';
            } else {
                this.toggleAllBtn.title = '全部展开 (openallcloze)';
            }
            this.resetNavigationState();
        });

        // 2. reverseclozestat
        this.reverseBtn.addEventListener('click', () => {
            editor.renderEl.querySelectorAll('.cloze').forEach(el => {
                el.classList.toggle('hidden');
            });
            this.resetNavigationState();
        });

        // 3. 上一个关闭cloze
        this.prevBtn.addEventListener('click', () => {
            this.navigateHiddenCloze(editor, -1);
        });

        // 4. 下一个关闭cloze
        this.nextBtn.addEventListener('click', () => {
            this.navigateHiddenCloze(editor, 1);
        });
    }
    
    /** @private */
    updateHiddenClozesCache(editor) {
        this.hiddenClozesCache = Array.from(editor.renderEl.querySelectorAll('.cloze.hidden'));
    }

    /** @private */
    resetNavigationState() {
        this.currentHiddenClozeIndex = -1;
        this.hiddenClozesCache = [];
        // Remove old highlights from the DOM
        document.querySelectorAll('.cloze-nav-highlight').forEach(el => el.classList.remove('cloze-nav-highlight'));
    }
    
    /** @private */
    navigateHiddenCloze(editor, direction) {
        // Always refresh the list of hidden clozes to reflect the current state
        this.updateHiddenClozesCache(editor);

        const clozes = this.hiddenClozesCache;
        if (clozes.length === 0) {
            this.currentHiddenClozeIndex = -1;
            return;
        }

        // Remove highlight from the previously focused element
        const oldHighlight = editor.renderEl.querySelector('.cloze-nav-highlight');
        if(oldHighlight) oldHighlight.classList.remove('cloze-nav-highlight');

        // Calculate the next index, wrapping around if necessary
        this.currentHiddenClozeIndex += direction;
        if (this.currentHiddenClozeIndex >= clozes.length) {
            this.currentHiddenClozeIndex = 0;
        } else if (this.currentHiddenClozeIndex < 0) {
            this.currentHiddenClozeIndex = clozes.length - 1;
        }
        
        const nextCloze = clozes[this.currentHiddenClozeIndex];
        if (nextCloze) {
            nextCloze.scrollIntoView({ behavior: 'smooth', block: 'center' });
            nextCloze.classList.add('cloze-nav-highlight');
        }
    }

    destroy() {
        if (this.panelEl) {
            this.panelEl.remove();
            this.panelEl = null;
        }
    }
}
