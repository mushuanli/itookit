// src/agent/components/ToolbarComponent.js
import { escapeHTML } from '../../common/utils.js';

export class ToolbarComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            toggleTopicsBtn: document.getElementById('agent_toggleTopicsBtn'),
            editTopicBtn: document.getElementById('agent_editTopicBtn'),
            manageTopicsBtn: document.getElementById('agent_manageTopicsBtn'),
            historyHeaderTitle: document.getElementById('agent_historyHeaderTitle'),
            conversationRoleSelector: document.getElementById('agent_conversationRoleSelector'),
            // [新增] AI 按钮的引用
            aiBtn: document.getElementById('agent_aiBtn'),
        };
        this.store.subscribe(this.render.bind(this), [
            'isTopicsPanelHidden', 'currentTopicId', 'topics', 
            'agents', 'currentConversationAgentId',
            'editorSelection', 'previewSelection' // 订阅选区变化
        ]);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.toggleTopicsBtn.addEventListener('click', () => this.store.toggleTopicsPanel());
        this.dom.manageTopicsBtn.addEventListener('click', () => this.store.enterSelectionMode());
        this.dom.editTopicBtn.addEventListener('click', () => {
            const topic = this.store.getState().topics.find(t => t.id === this.store.getState().currentTopicId);
            if (topic) {
                const newName = prompt("请输入新的主题名称:", topic.title);
                if (newName && newName.trim() !== topic.title) {
                    this.store.renameCurrentTopic(newName.trim());
                }
            }
        });
        this.dom.conversationRoleSelector.addEventListener('change', (e) => {
            this.store.setConversationAgent(e.target.value || null);
        });
        
        // [新增] AI 按钮的事件监听器
        this.dom.aiBtn.addEventListener('click', () => this.handleAiButtonClick());
    }

    // [新增] AI 按钮的点击处理逻辑
    handleAiButtonClick() {
        console.log('🤖 [Agent ToolbarComponent] AI button clicked');
        const state = this.store.getState();
        const chatInputElement = document.getElementById('agent_chatInput');

        let content = '';
        let source = '';
        
        // 策略1：优先使用在历史记录中选择的文本
        if (state.previewSelection && state.previewSelection.hasSelection) {
            content = state.previewSelection.text;
            source = 'History Panel Selection';
        } 
        // 策略2：其次使用在输入框中选择的文本
        else if (state.editorSelection && state.editorSelection.hasSelection) {
            content = state.editorSelection.text;
            source = 'Chat Input Selection';
        } 
        // 策略3：最后，如果输入框中有内容，则使用输入框的全部内容作为后备
        else if (chatInputElement && chatInputElement.value.trim()) {
            content = chatInputElement.value.trim();
            source = 'Full Chat Input Fallback';
        }

        if (content) {
            console.log(`✅ [Agent ToolbarComponent] Using content from: ${source}`);
            if (window.appController && typeof window.appController.showAiPopup === 'function') {
                window.appController.showAiPopup(content);
            } else {
                console.error("appController is not available to show AI popup.");
            }
        } else {
            console.warn('⚠️ [Agent ToolbarComponent] No content available to send to AI.');
            alert("没有可发送给 AI 的内容。请先在聊天记录或输入框中选择文本，或在输入框中输入内容。");
        }
    }

    render(state) {
        // Toggle Button
        this.dom.toggleTopicsBtn.title = state.isTopicsPanelHidden ? "显示主题栏" : "隐藏主题栏";

        // Edit/Manage Buttons
        this.dom.editTopicBtn.style.display = state.currentTopicId ? 'block' : 'none';
        
        // Header Title
        if (state.currentTopicId) {
            const topic = state.topics.find(t => t.id === state.currentTopicId);
            this.dom.historyHeaderTitle.textContent = topic ? `${escapeHTML(topic.title)} - 对话记录` : '对话记录';
        } else {
            this.dom.historyHeaderTitle.textContent = '选择一个主题开始';
        }

        // Role Selector
        this.dom.conversationRoleSelector.innerHTML = `<option value="">默认 AI (无角色)</option>`;
        state.agents.forEach(agent => {
            const option = document.createElement('option');
            option.value = agent.id;
            option.textContent = agent.name;
            this.dom.conversationRoleSelector.appendChild(option);
        });
        this.dom.conversationRoleSelector.value = state.currentConversationAgentId || "";
    }
}
