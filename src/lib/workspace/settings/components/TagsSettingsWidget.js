/**
 * @file @workspace/settings/components/TagsSettingsWidget.js
 * @description 一个用于管理全局标签的设置组件，实现了 ISettingsWidget 接口。
 * @change
 * - [改进] 增加了对 "default" 标签的删除保护。
 * - [改进] 在删除标签前，检查其是否被任何 Agent 使用，以保证数据完整性。
 */

import { ISettingsWidget } from '../../../common/interfaces/ISettingsWidget.js';
import { ConfigManager } from '../../../config/ConfigManager.js';
import { EVENTS } from '../../../config/shared/constants.js';
import './TagsSettingsWidget.css'; // 引入组件专属样式

// +++ 新增: 定义不可删除的受保护标签
const PROTECTED_TAGS = ['default'];

export class TagsSettingsWidget extends ISettingsWidget {
    constructor() {
        super();
        this.isMounted = false;
        /** @private */
        this.container = null;
        /** @private */
        this.configManager = ConfigManager.getInstance();
        /** @private */
        this.tagRepo = this.configManager.tags;
        // +++ 新增: 获取 LLM 服务以检查 Agent 依赖
        /** @private */
        this.llmService = this.configManager.llmService;
        /** @private */
        this.eventManager = this.configManager.eventManager;
        /** @private */
        this.ui = {};
        /** @private */
        this._unsubscribe = null;
        /** @private */
        this._boundHandleSubmit = this._handleSubmit.bind(this);
        /** @private */
        this._boundHandleListClick = this._handleListClick.bind(this);
        /** @private */
        this._boundRenderTags = this.renderTags.bind(this);
    }

    // --- ISettingsWidget 接口实现 ---

    get id() { return 'global-tags-manager'; }
    get label() { return 'Tags'; }
    get iconHTML() { return '🏷️'; }
    get description() { return '管理应用中所有全局标签。'; }

    // --- 生命周期方法 ---

    async mount(container) {
        if (this.isMounted) return;
        this.container = container;
        this.isMounted = true;

        this._renderShell();
        
        // 初始加载并渲染标签
        await this.tagRepo.load();
        this.renderTags();

        this._attachEventListeners();
        this.emit('mounted');
    }

    async unmount() {
        if (!this.isMounted) return;
        this._removeEventListeners();
        this.container.innerHTML = '';
        this.container = null;
        this.isMounted = false;
        this.emit('unmounted');
    }

    async destroy() {
        await this.unmount();
    }

    // --- 私有方法 ---

    _renderShell() {
        this.container.innerHTML = `
            <div class="tags-widget-container">
                <h3>全局标签管理</h3>
                <p>${this.description}</p>
                <form class="tags-widget-form">
                    <input type="text" placeholder="输入新标签后按 Enter 添加" required />
                    <button type="submit" class="settings-btn">添加</button>
                </form>
                <ul class="tags-widget-list">
                    <!-- 标签将在这里动态渲染 -->
                </ul>
            </div>
        `;
        this.ui = {
            form: this.container.querySelector('.tags-widget-form'),
            input: this.container.querySelector('.tags-widget-form input'),
            list: this.container.querySelector('.tags-widget-list'),
        };
    }

    renderTags() {
        if (!this.isMounted) return;
        const tags = this.tagRepo.getAll();
        this.ui.list.innerHTML = tags.map(tag => {
            // +++ 改进: 检查标签是否受保护
            const isProtected = PROTECTED_TAGS.includes(tag);
            const deleteButton = isProtected
                ? `<button class="delete-tag-btn" disabled title="这是一个受保护的标签，不能删除。">&times;</button>`
                : `<button class="delete-tag-btn" data-tag="${tag}" title="删除标签">&times;</button>`;

            return `
                <li class="${isProtected ? 'protected' : ''}">
                    <span>${tag}</span>
                    ${deleteButton}
                </li>
            `;
        }).join('');
    }

    _attachEventListeners() {
        this.ui.form.addEventListener('submit', this._boundHandleSubmit);
        this.ui.list.addEventListener('click', this._boundHandleListClick);
        // 订阅全局标签更新事件，确保UI实时同步
        this._unsubscribe = this.eventManager.subscribe(EVENTS.TAGS_UPDATED, this._boundRenderTags);
    }

    _removeEventListeners() {
        this.ui.form?.removeEventListener('submit', this._boundHandleSubmit);
        this.ui.list?.removeEventListener('click', this._boundHandleListClick);
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    }

    _handleSubmit(event) {
        event.preventDefault();
        const newTag = this.ui.input.value.trim();
        if (newTag) {
            this.tagRepo.addTag(newTag);
            this.ui.input.value = ''; // 清空输入框
        }
    }

    /**
     * +++ 核心改进: 重写点击处理逻辑，增加检查 +++
     */
    async _handleListClick(event) {
        const deleteBtn = event.target.closest('.delete-tag-btn:not([disabled])');
        if (!deleteBtn) return;

        const tagToDelete = deleteBtn.dataset.tag;

        // 1. 防御性检查，防止通过dev tools删除保护标签
        if (PROTECTED_TAGS.includes(tagToDelete)) {
            alert(`错误：受保护的标签 "${tagToDelete}" 不能被删除。`);
            return;
        }

        //  TODO: support all workspace delete tag action.
        // 2. 检查此标签是否被任何 Agent 使用 (异步操作)
        const allAgents = await this.llmService.getAgents();
        const dependentAgents = allAgents.filter(agent => agent.tags?.includes(tagToDelete));

        if (dependentAgents.length > 0) {
            const agentNames = dependentAgents.map(a => `"${a.name}"`).join(', ');
            alert(
                `无法删除标签 "${tagToDelete}"。\n\n` +
                `它正在被以下 Agent 使用: ${agentNames}。\n\n` +
                `请先从这些 Agent 中移除该标签，然后再试。`
            );
            return; // 阻止删除
        }

        // 3. 如果所有检查通过，则弹出确认框并执行删除
        if (confirm(`确定要永久删除标签 "${tagToDelete}" 吗？此操作不可撤销。`)) {
            await this.tagRepo.removeTag(tagToDelete);
        }
    }
}
