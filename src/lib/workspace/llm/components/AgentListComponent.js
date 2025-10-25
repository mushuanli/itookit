import { escapeHTML } from '../../../common/utils/utils.js';

/**
 * @file AgentListComponent.js
 * @description A new, lightweight component to display a list of LLM Agents.
 */
export class AgentListComponent {
    /**
     * @param {object} options
     * @param {HTMLElement} options.container
     * @param {import('../../../configManager/index.js').ConfigManager} options.configManager
     * @param {(agent: object) => void} options.onAgentSelect
     * @param {object[]} [options.initialAgents] - [新增] An optional predefined list of agents.
     */
    constructor({ container, configManager, onAgentSelect, initialAgents }) {
        this.container = container;
        this.configManager = configManager;
        this.onAgentSelect = onAgentSelect;
        this.agents = initialAgents || []; // [修改] 使用传入的列表
        this._handleDoubleClick = this._handleDoubleClick.bind(this);
    }

    /**
     * Initializes the component by fetching agents and rendering the list.
     * @returns {Promise<void>}
     */
    async init() {
        // [修改] 如果已经有 initialAgents，就不再显示加载状态并重新获取
        if (this.agents.length > 0) {
            this.render();
            this._bindEvents();
            return;
        }

        this.container.innerHTML = `<div class="agent-list-placeholder">正在加载 Agents...</div>`;
        try {
            // Fetch agents via the LLMService provided by ConfigManager
            this.agents = await this.configManager.llm.getAgents();
            this.render();
            this._bindEvents();
        } catch (error) {
            console.error("Failed to load agents:", error);
            this.container.innerHTML = `<div class="agent-list-placeholder agent-list-placeholder--error">加载 Agents 失败</div>`;
        }
    }

    /**
     * Renders the agent list HTML into the container.
     */
    render() {
        const headerHTML = `
            <div class="mdx-session-list__title-bar">
                <h2 class="mdx-session-list__title">Agents</h2>
            </div>`;

        if (!this.agents || this.agents.length === 0) {
            this.container.innerHTML = headerHTML + `<div class="agent-list-placeholder">没有可用的 Agent</div>`;
            return;
        }

        const listHTML = this.agents.map(agent => `
            <li class="agent-list-item" data-agent-id="${escapeHTML(agent.id)}" title="双击选择 ${escapeHTML(agent.name)}">
                <span class="agent-list-item__icon">${escapeHTML(agent.icon || '🤖')}</span>
                <div class="agent-list-item__content">
                    <div class="agent-list-item__name">${escapeHTML(agent.name)}</div>
                    <div class="agent-list-item__description">${escapeHTML(agent.description || '暂无描述')}</div>
                </div>
            </li>
        `).join('');

        this.container.innerHTML = headerHTML + `<ul class="agent-list">${listHTML}</ul>`;
    }

    /**
     * Binds necessary DOM events.
     * @private
     */
    _bindEvents() {
        this.container.addEventListener('dblclick', this._handleDoubleClick);
    }
    
    /**
     * Handles the double-click event on an agent item.
     * @param {MouseEvent} event
     * @private
     */
    _handleDoubleClick(event) {
        const itemEl = event.target.closest('.agent-list-item');
        if (itemEl && this.onAgentSelect) {
            const agentId = itemEl.dataset.agentId;
            const selectedAgent = this.agents.find(a => a.id === agentId);
            if (selectedAgent) {
                this.onAgentSelect(selectedAgent);
            }
        }
    }

    /**
     * Cleans up event listeners and removes HTML from the container.
     */
    destroy() {
        this.container.removeEventListener('dblclick', this._handleDoubleClick);
        this.container.innerHTML = '';
        console.log('[AgentListComponent] Destroyed.');
    }
}
