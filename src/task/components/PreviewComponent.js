// src/task/components/PreviewComponent.js
import { RichContentRenderer } from '../../common/RichContentRenderer.js';
import { MarkdownYamlParser } from '../../common/MarkdownYamlParser.js';
import { FieldFormatter } from '../../common/FieldFormatter.js';
import { FIELD_SCHEMA } from '../config/fieldSchema.js';

export class PreviewComponent {
    constructor(store) {
        this.store = store;
        this.dom = { container: document.getElementById('task_previewContainer') };
        
        // [重构] 将订阅回调指向 handleStateChange，并添加 selectedTaskId 以触发滚动效果
        this.unsubscribe = store.subscribe(
            this.handleStateChange.bind(this), 
            ['mainViewMode', 'markdownContent', 'selectedTaskId']
        );
        this.setupEventListeners();
    }

    setupEventListeners() {
        // AI 选区功能：监听鼠标释放事件以捕获选区
        this.dom.container.addEventListener('mouseup', this.handleSelection.bind(this));

        // 卡片内交互功能：监听点击事件
        this.dom.container.addEventListener('click', e => {
            const card = e.target.closest('.task-card');
            if (!card) return;
            if (e.target.matches('.show-answer-btn')) {
                card.querySelector('.answer-section').classList.remove('hidden');
                e.target.classList.add('hidden');
            }
            const reviewBtn = e.target.closest('.review-btn');
            if (reviewBtn) {
                this.store.rateTask(card.dataset.id, parseInt(reviewBtn.dataset.rating, 10));
            }
        });
    }

    // [新增] 用于 AI 选区的功能
    handleSelection(e) {
        // 确保不是在点击交互元素时触发
        if (e.target.closest('.review-btn, .show-answer-btn, a, button')) {
            return;
        }

        const selectedText = window.getSelection().toString();
        
        // 调用 store action 来更新预览区的选区状态
        this.store.setPreviewSelection(selectedText);
    }

    // [恢复] 状态变化处理器，现在它被正确调用了
    handleStateChange(newState, oldState) {
        // 1. 始终先执行渲染，确保 DOM 是最新的
        this.render(newState);

        // 2. 检查 selectedTaskId 是否发生了变化，并触发高亮和滚动
        //    只在视图切换后或任务ID改变时触发，避免不必要的滚动
        if (newState.selectedTaskId && newState.selectedTaskId !== oldState.selectedTaskId) {
            // 使用 requestAnimationFrame 确保在浏览器下一次重绘前执行DOM操作
            requestAnimationFrame(() => {
                const card = this.dom.container.querySelector(`.task-card[data-id="${newState.selectedTaskId}"]`);
                if (card) {
                    // 滚动到视图
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // 添加高亮效果，并在 1.5 秒后移除
                    card.classList.add('highlight');
                    setTimeout(() => card.classList.remove('highlight'), 1500);
                }
            });
        }
    }

    // [保留] render 方法现在由 handleStateChange 调用
    async render(state) {
        // 只在预览模式下执行渲染逻辑
        if (state.mainViewMode !== 'preview') {
            return;
        }

        const { markdownContent } = state;

        if (!markdownContent || !markdownContent.trim()) {
            this.dom.container.innerHTML = '<div class="empty-preview"><p>没有内容可供预览</p></div>';
            return;
        }
        
        // 1. 使用重构后的解析器分离结构化数据和普通描述
        const parseResult = MarkdownYamlParser.parseMarkdownToYaml(state.markdownContent);
        if (!parseResult.success) {
            this.dom.container.innerHTML = `<div class="error-preview"><p>内容解析失败: ${parseResult.error}</p></div>`;
            return;
        }
        const { data } = parseResult;

        // [重构] 渲染结构化字段，并过滤空值
        let fieldsHTML = '';
        let hasVisibleFields = false;
        for (const fieldName in FIELD_SCHEMA) {
            const value = data[fieldName];
            // [关键] 只有当字段值存在且不为空时才渲染
            if (value != null && value !== '') {
                fieldsHTML += FieldFormatter.format(fieldName, value);
                hasVisibleFields = true;
            }
        }
        
        // [重构] 渲染主体 Markdown 内容
        const detailsContainer = document.createElement('div');
        detailsContainer.className = 'task-details-content';
        if (data.details) {
            await RichContentRenderer.render(detailsContainer, data.details, {});
        }

        // [重构] 组合最终的、有结构的 HTML
        this.dom.container.innerHTML = ''; // 清空容器

        // 只有存在可见字段时，才创建元数据面板
        if (hasVisibleFields) {
            const metadataPanel = document.createElement('div');
            metadataPanel.className = 'task-metadata-panel';
            metadataPanel.innerHTML = fieldsHTML;
            this.dom.container.appendChild(metadataPanel);
        }

        // 如果存在正文，则添加
        if (detailsContainer.innerHTML) {
            this.dom.container.appendChild(detailsContainer);
        }
    }
    
    destroy() { 
        this.unsubscribe(); 
    }
}
