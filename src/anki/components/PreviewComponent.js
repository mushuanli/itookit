// src/anki/components/PreviewComponent.js

// [修正] 移除了对 renderService 的无效导入
// import { renderMathAndMermaid, processTaskLists } from '../services/renderService.js';
import { audioService } from '../services/audioService.js';

export class PreviewComponent {
    constructor(store) {
        this.store = store;
        this.element = document.getElementById('anki_preview');

        // [优化] 只订阅 'previewContent' 和 'viewMode' 的变化
        this.unsubscribe = store.subscribe(
            this.handleStateChange.bind(this),
            [
                'previewContent', 
                'viewMode', 
                'clozeStates', 
                'areAllClozesVisible', 
                'highlightedClozeId', 
                'editorScrollRatio',
                'highlightedHeadingId' // <-- 确保这一行存在
            ]
        );
        this.setupEventListeners();
    }
  
    setupEventListeners() {
        // [修改] 移除 'change' 事件监听，统一到 'click' 中处理
        // this.element.addEventListener('change', this.handleCheckboxChange.bind(this));
        
        this.element.addEventListener('click', this.handleClick.bind(this));
        this.element.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        
        // [RESTORED] 重新添加 mouseup 事件监听器，这是为 AI 按钮提供选区所必需的
        this.element.addEventListener('mouseup', this.handleSelection.bind(this));

        this.element.addEventListener('scroll', () => {
            if (this.store.getState().viewMode === 'preview') {
                const preview = this.element;
                if (preview.scrollHeight > preview.clientHeight) {
                    const scrollRatio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
                    this.store.setScrollRatio(Math.min(1, Math.max(0, scrollRatio)));
                }
            }
        });
    }

    /**
     * [移除] 此方法不再需要，逻辑已合并到 handleClick
     */
    // handleCheckboxChange(e) { ... }


    /**
     * [RESTORED] 恢复处理文本选择的函数，专门用于更新 state.previewSelection
     * 这个状态被 ToolbarComponent 的 AI 按钮功能所依赖。
     * @param {MouseEvent} e 
     */
    handleSelection(e) {
        if (e.target.closest('.cloze, a, button, input')) { // 防止在 input 上选择时触发
            return;
        }

        const selectedText = window.getSelection().toString();
        
        // 调用 store action 来更新预览区的选区状态
        // 即使选区为空，也要调用一次，以清除过时的选区状态
        this.store.setPreviewSelection(selectedText);
    }

    // [重构] 将所有点击逻辑统一到此函数
    handleClick(e) {
        // --- 逻辑1: 处理自定义的 `::>` 折叠任务项 ---
        const foldableTaskCheckbox = e.target.closest('.task-checkbox-in-summary');
        if (foldableTaskCheckbox) {
            e.preventDefault(); 
            const taskTitle = foldableTaskCheckbox.dataset.taskTitle;
            if (taskTitle) {
                // 调用 store action 来更新原始 Markdown
                this.store.toggleTaskInContent(taskTitle);
            }
            return;
        }
        
        // --- [新增逻辑] 逻辑2: 处理标准的 GFM 任务列表项 ---
        if (e.target.matches('.task-list-item input[type="checkbox"]')) {
            const listItem = e.target.closest('.task-list-item');
            if (listItem) {
                // 阻止浏览器的默认行为，让 Store 成为唯一的数据源
                e.preventDefault();
                const taskText = listItem.textContent.trim();
                if (taskText) {
                    // 调用在 store 中定义的 action
                    this.store.toggleListItemTask(taskText);
                }
            }
            return; // 处理完毕，退出函数
        }

        const cloze = e.target.closest('.cloze');
        if (!cloze) return;

        // 1. 处理评分按钮
        if (e.target.closest('.cloze-btn')) {
            e.stopPropagation();
            const button = e.target.closest('.cloze-btn');
            const rating = parseInt(button.dataset.rating, 10);
            this.store.rateCloze(cloze.dataset.clozeId, rating);
            return;
        }

        // 2. 处理媒体图标
        if (e.target.closest('.media-icon')) {
            e.stopPropagation();
            // --- 修改开始 ---
            const audioText = cloze.dataset.multimedia;
            if (audioText) {
                audioService.play(audioText);
            }
            return;
        }
        
        // 3. 处理普通点击以显示Cloze
        this.store.recordClozeInteraction(cloze.dataset.clozeId);
        
        // --- 开始修改 ---
        const audioText = cloze.dataset.multimedia;
        const isCurrentlyHidden = cloze.classList.contains('hidden');

        // 如果Cloze当前是隐藏的，并且它有关联的音频，则在显示它之前播放音频。
        if (isCurrentlyHidden && audioText) {
            audioService.play(audioText);
        }
        // --- 结束修改 ---
        
        // 切换可见性的动作照常执行
        this.store.toggleClozeVisibility(cloze.dataset.clozeId);
    }

    /**
     * [REFACTORED] 统一处理双击事件。
     * - 如果双击在 Cloze 上，则执行 Cloze 相关操作。
     * - 如果双击在普通文本上，则触发“跳转到编辑器并选中”的流程。
     */
    handleDoubleClick(e) {
        const cloze = e.target.closest('.cloze');
        if (cloze) {
            // 场景 1: 双击在已有的 Cloze 上，执行永久切换可见性
            e.stopPropagation();
            // 双击用于永久切换可见性 (这个逻辑可以在 store action 中实现)
            this.store.toggleClozeVisibility(cloze.dataset.clozeId);
            return;
        }
        
        // 场景 2: [新逻辑] 检查是否按下了 Ctrl 或 Command 键
        // e.metaKey 对应 macOS 上的 Command 键，以实现跨平台兼容
        if (e.ctrlKey || e.metaKey) {
            const selectedText = window.getSelection().toString().trim();
            if (selectedText) {
                // 仅在按下组合键时，才调用 store action，请求在编辑器中选中这段文本
                this.store.selectTextInEditor(selectedText);
            }
        }
        // 如果是普通的双击（没有按住 Ctrl/Cmd），则不执行任何操作。
    }
  
    async handleStateChange(newState, oldState) {
        const shouldRedraw = (newState.previewContent !== oldState.previewContent && newState.previewContent) || 
                             (!oldState.previewContent && newState.previewContent);

        if (shouldRedraw) {
            this.element.innerHTML = newState.previewContent;
            // 不再需要调用 processTaskLists 或 renderMathAndMermaid，
            // 因为 RichContentRenderer 在 ankiStore._doUpdatePreview 中已经完成了所有工作。
        } else if (!newState.previewContent && !this.element.innerHTML.includes('empty-preview')) {
            this.element.innerHTML = '<div class="empty-preview"><p>暂无内容</p></div>';
        }

        // 2. 高效更新Cloze的可见性，避免重绘
        if (newState.clozeStates !== oldState.clozeStates || newState.areAllClozesVisible !== oldState.areAllClozesVisible) {
            this.updateClozeVisibility(newState);
        }

        // 3. 处理视图模式切换
        if (newState.viewMode !== oldState.viewMode || oldState.viewMode === undefined) {
            const isVisible = newState.viewMode === 'preview';
            this.element.style.display = isVisible ? 'block' : 'none';
        }

        // 4. 同步滚动位置
        if (newState.viewMode === 'preview' && oldState.viewMode === 'edit') {
            requestAnimationFrame(() => {
                const preview = this.element;
                if (preview.scrollHeight > preview.clientHeight) {
                    preview.scrollTop = newState.editorScrollRatio * (preview.scrollHeight - preview.clientHeight);
                }
            });
        }
        
        // 5. 处理导航高亮
        if (newState.highlightedClozeId && newState.highlightedClozeId !== oldState.highlightedClozeId) {
            this.highlightAndScrollToCloze(newState.highlightedClozeId);
        }

        // [新增] 处理标题导航高亮和滚动
        if (newState.highlightedHeadingId && newState.highlightedHeadingId !== oldState.highlightedHeadingId) {
            this.highlightAndScrollToHeading(newState.highlightedHeadingId);
        }
    }

    updateClozeVisibility(state) {
        const allClozes = this.element.querySelectorAll('.cloze');
        allClozes.forEach(clozeEl => {
            const id = clozeEl.dataset.clozeId;
            const clozeState = state.clozeStates[id];
            if (!clozeState) return;

            const isHidden = !state.areAllClozesVisible && !clozeState.tempVisible;
            clozeEl.classList.toggle('hidden', isHidden);
            
            const actionsEl = clozeEl.querySelector('.cloze-actions');
            if (actionsEl) {
                actionsEl.style.display = !isHidden && !state.areAllClozesVisible ? 'flex' : 'none';
            }
        });
    }

    highlightAndScrollToCloze(clozeId) {
        const target = this.element.querySelector(`.cloze[data-cloze-id="${clozeId}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('cloze-nav-active');
            setTimeout(() => target.classList.remove('cloze-nav-active'), 1500);
        }
    }
  
    /**
     * [优化] 滚动到指定的标题并高亮
     * @param {string} headingId - The slugified ID of the heading element.
     */
    highlightAndScrollToHeading(headingId) {
        try {
            // 使用 CSS.escape() 来处理可能包含特殊字符的ID，更加健壮
            const target = this.element.querySelector(`#${CSS.escape(headingId)}`);
            if (target) {
                // 滚动到视图中央
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // 添加一个高亮动画类
                target.classList.add('highlight-heading');
                
                // 动画结束后移除该类，以便下次可以再次触发
                setTimeout(() => {
                    target.classList.remove('highlight-heading');
                }, 1500); // 动画持续时间为1.5秒
            } else {
                console.warn(`Heading with ID #${headingId} not found in preview.`);
            }
        } catch (error) {
            console.error(`Error scrolling to heading with ID: #${headingId}`, error);
        }
    }

    destroy() {
        this.unsubscribe();
    }
}
