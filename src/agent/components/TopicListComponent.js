// src/agent/components/TopicListComponent.js
import { escapeHTML } from '../../common/utils.js';
// [移除] 不再需要 dataService
// import * as dataService from '../../services/dataService.js'; 

export class TopicListComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            panel: document.querySelector('.agent_topics-panel'),
            list: document.getElementById('agent_topicList'),
            filter: document.getElementById('agent_topicTagFilter'),
            batchActions: document.getElementById('agent_topicsBatchActions'),
            selectAllBtn: document.getElementById('agent_selectAllTopicsBtn'),
            deleteSelectedBtn: document.getElementById('agent_deleteSelectedTopicsBtn'),
            cancelBtn: document.getElementById('agent_cancelTopicSelectionBtn'),
            // [新增] 新增头部 "+" 按钮的引用
            addTopicBtnHeader: document.getElementById('agent_addTopicHeaderBtn'),
        };
        this.store.subscribe(this.render.bind(this), [
            'isTopicsPanelHidden', 'topics', 'currentTopicId', 'agents',
            'isTopicSelectionMode', 'selectedTopicIds', 'topicListFilterTag', 'history'
        ]);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.filter.addEventListener('change', e => this.store.setTopicFilter(e.target.value));
        this.dom.list.addEventListener('click', e => this.handleListClick(e));
        this.dom.cancelBtn.addEventListener('click', () => this.store.cancelSelectionMode());
        this.dom.selectAllBtn.addEventListener('click', () => this.store.selectAllTopics());
        this.dom.deleteSelectedBtn.addEventListener('click', () => {
            const ids = this.store.getState().selectedTopicIds;
            if (ids.size > 0 && confirm(`确定要删除选中的 ${ids.size} 个主题吗？`)) {
                this.store.deleteTopics(Array.from(ids));
            }
        });

        // [新增] 为头部 "+" 按钮添加事件监听器
        this.dom.addTopicBtnHeader.addEventListener('click', () => this.handleAddTopicClick());
    }
    
    // [新增] 头部 "+" 按钮的点击处理函数
    handleAddTopicClick() {
        const title = prompt("请输入新主题的名称:");
        if (title) {
            this.store.addTopic(title);
        }
    }

    handleListClick(e) {
        const state = this.store.getState();
        const topicItem = e.target.closest('.topic-item');
        if (!topicItem) return;

        if (topicItem.classList.contains('add-topic-btn')) {
            this.handleAddTopicClick(); // 复用相同的处理逻辑
            return;
        }

        const topicId = topicItem.dataset.topicId;
        if (state.isTopicSelectionMode) {
            this.store.toggleTopicSelection(topicId);
        } else {
            this.store.selectTopic(topicId);
        }
    }

    render(state) {
        this.dom.panel.classList.toggle('collapsed', state.isTopicsPanelHidden);
        
        // Render Filters
        const allTags = [...new Set(state.agents.flatMap(agent => agent.tags || []))];
        this.dom.filter.innerHTML = '<option value="all">所有主题</option>';
        allTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            this.dom.filter.appendChild(option);
        });
        this.dom.filter.value = state.topicListFilterTag;
        
        // Render Topic List
        this.dom.list.innerHTML = '';
        
        // [修正] 调用 Store 的新方法来获取派生数据
        const filteredTopics = this.store.getFilteredTopics();
        
        filteredTopics.forEach(topic => this.dom.list.appendChild(this.createTopicItem(topic, state)));
        
        // Add "New Topic" button
        const addTopicBtn = document.createElement('li');
        addTopicBtn.className = 'topic-item add-topic-btn';
        addTopicBtn.innerHTML = `<div class="topic-item-content"><div class="topic-icon"><i class="fas fa-plus"></i></div><span>添加新主题</span></div>`;
        this.dom.list.appendChild(addTopicBtn);

        // Render Batch Actions
        this.dom.batchActions.style.display = state.isTopicSelectionMode ? 'flex' : 'none';
        if (state.isTopicSelectionMode) {
            const count = state.selectedTopicIds.size;
            this.dom.deleteSelectedBtn.textContent = `删除选中 (${count})`;
            this.dom.deleteSelectedBtn.disabled = count === 0;
            const allVisibleIds = filteredTopics.map(t => t.id);
            this.dom.selectAllBtn.textContent = (allVisibleIds.length > 0 && count === allVisibleIds.length) ? '全不选' : '全选';
        }
    }

    createTopicItem(topic, state) {
        const item = document.createElement('li');
        item.className = `topic-item ${topic.id === state.currentTopicId ? 'active' : ''}`;
        item.dataset.topicId = topic.id;
        
        const checkboxHTML = state.isTopicSelectionMode
            ? `<input type="checkbox" class="topic-selection-checkbox" ${state.selectedTopicIds.has(topic.id) ? 'checked' : ''}>`
            : '';

        item.innerHTML = `
            ${checkboxHTML}
            <div class="topic-item-content">
                <div class="topic-icon"><i class="${escapeHTML(topic.icon || 'fas fa-comment')}"></i></div>
                <span>${escapeHTML(topic.title)}</span>
            </div>
        `;
        return item;
    }
}
