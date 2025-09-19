// src/common/AiPopupComponent.js
import { escapeHTML } from './utils.js';

export class AiPopupComponent {
    /**
     * @param {object} agentStore - The global agent store instance.
     * @param {function} switchView - A function to switch the main app view.
     */
    constructor(agentStore, switchView) {
        this.agentStore = agentStore;
        this.switchView = switchView;
        this.dom = {
            overlay: document.getElementById('ai-popup-overlay'),
            closeBtn: document.getElementById('ai-popup-close-btn'),
            cancelBtn: document.getElementById('ai-popup-cancel-btn'),
            sendBtn: document.getElementById('ai-popup-send-btn'),
            agentSelector: document.getElementById('ai-popup-agent-selector'),
            textarea: document.getElementById('ai-popup-textarea'),
        };
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.closeBtn.addEventListener('click', () => this.hide());
        this.dom.cancelBtn.addEventListener('click', () => this.hide());
        this.dom.sendBtn.addEventListener('click', () => this.handleSend());
        this.dom.overlay.addEventListener('click', (e) => {
            if (e.target === this.dom.overlay) {
                this.hide();
            }
        });
    }

    /**
     * Shows the AI popup with initial content.
     * @param {string} initialContent - The text from the selection or the full editor content.
     */
    show(initialContent) {
        this.dom.textarea.value = initialContent;
        this.populateAgentSelector();
        this.dom.overlay.style.display = 'flex';
        this.dom.textarea.focus();
    }

    hide() {
        this.dom.overlay.style.display = 'none';
        this.dom.textarea.value = '';
        this.dom.agentSelector.innerHTML = '';
    }

    populateAgentSelector() {
        const { agents } = this.agentStore.getState();
        this.dom.agentSelector.innerHTML = '<option value="">默认 AI (无角色)</option>'; // Default option
        agents.forEach(agent => {
            this.dom.agentSelector.innerHTML += `<option value="${escapeHTML(agent.id)}">${escapeHTML(agent.name)}</option>`;
        });
    }

    async handleSend() {
        const content = this.dom.textarea.value.trim();
        const agentId = this.dom.agentSelector.value || null;

        if (!content) {
            alert('内容不能为空！');
            return;
        }

        this.hide();
        
        // Switch to the agent view to show the user the new conversation
        this.switchView('agent');
        
        // Use a slight delay to allow the view to switch before processing
        setTimeout(async () => {
            try {
                await this.agentStore.startConversationFromExternal(content, agentId);
            } catch (error) {
                console.error("Failed to start conversation from external source:", error);
                alert("创建 AI 对话失败，请检查控制台获取更多信息。");
            }
        }, 100);
    }
}
