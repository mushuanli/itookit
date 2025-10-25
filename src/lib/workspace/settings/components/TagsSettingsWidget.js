/**
 * 文件: #workspace/settings/components/TagsSettingsWidget.js
 * @description 一个用于管理全局标签的设置组件，实现了 ISettingsWidget 接口。
 * @change
 * - [V4] 适配重构后的 ConfigManager API
 * - [改进] 增加了对 "default" 标签的删除保护
 * - [改进] 在删除标签前，检查其是否被任何 Agent 使用，以保证数据完整性
 */

import { ISettingsWidget } from '../../../common/interfaces/ISettingsWidget.js';
import {PROTECTED_TAGS} from '../../../common/configData.js';
import { getConfigManager } from '../../../configManager/index.js';
import './TagsSettingsWidget.css';

export class TagsSettingsWidget extends ISettingsWidget {
    constructor() {
        super();
        this.isMounted = false;
        /** @private */
        this.container = null;
        
        // [核心修改] 使用 getConfigManager 获取单例
        /** @private */
        this.configManager = getConfigManager();
        /** @private */
        this.agentRepo = this.configManager.getService('agentRepository');
        
        /** @private */
        this.ui = {};
        /** @private */
        this._unsubscribers = []; // [改进] 使用数组存储多个取消订阅函数
        /** @private */
        this._allTags = []; // [新增] 缓存标签列表
        
        // 绑定方法
        /** @private */
        this._boundHandleSubmit = this._handleSubmit.bind(this);
        /** @private */
        this._boundHandleListClick = this._handleListClick.bind(this);
        /** @private */
        this._boundRenderTags = this._renderTags.bind(this);
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
        
        // [修改] 使用 ConfigManager 的 API 加载标签
        await this._loadTags();
        this._renderTags();

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

    /**
     * [新增] 加载所有标签
     * @private
     */
    async _loadTags() {
        try {
            const tagObjects = await this.configManager.getAllTags();
            // 提取标签名称
            this._allTags = tagObjects.map(t => t.name);
        } catch (error) {
            console.error('[TagsWidget] 加载标签失败:', error);
            this._allTags = [];
        }
    }

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

    /**
     * [重命名] renderTags -> _renderTags (私有方法)
     * @private
     */
    _renderTags() {
        if (!this.isMounted) return;
        
        this.ui.list.innerHTML = this._allTags.map(tag => {
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
        
        // [修正] 使用 configManager.on 订阅事件
        // 注意：需要确认事件名称是否正确
        this._unsubscribers.push(
            this.configManager.on('tags:updated', async () => {
                await this._loadTags();
                this._renderTags();
            })
        );
    }

    _removeEventListeners() {
        this.ui.form?.removeEventListener('submit', this._boundHandleSubmit);
        this.ui.list?.removeEventListener('click', this._boundHandleListClick);
        
        // [改进] 取消所有订阅
        this._unsubscribers.forEach(unsubscribe => unsubscribe());
        this._unsubscribers = [];
    }

    /**
     * [修改] 处理表单提交，添加新标签
     * @private
     */
    async _handleSubmit(event) {
        event.preventDefault();
        const newTag = this.ui.input.value.trim();
        if (!newTag) return;

        try {
            await this.configManager.addGlobalTag(newTag);
            await this._loadTags();
            this._renderTags();
            this.ui.input.value = '';
        } catch (error) {
            console.error('[TagsWidget] 添加标签失败:', error);
            alert(`添加标签失败: ${error.message}`);
        }
    }

    /**
     * [改进] 处理删除按钮点击
     * @private
     */
    async _handleListClick(event) {
        const deleteBtn = event.target.closest('.delete-tag-btn:not([disabled])');
        if (!deleteBtn) return;

        const tagToDelete = deleteBtn.dataset.tag;

        // 1. 防御性检查，防止删除保护标签
        if (PROTECTED_TAGS.includes(tagToDelete)) {
            alert(`错误：受保护的标签 "${tagToDelete}" 不能被删除。`);
            return;
        }

        // [核心修改] 使用注入的 llmService 来检查依赖
        try {
            // 2. 检查是否有 Agent 使用此标签
            const allAgents = await this.agentRepo.getAllAgents();
            const dependentAgents = allAgents.filter(agent => 
                agent.tags?.includes(tagToDelete)
            );

            if (dependentAgents.length > 0) {
                const agentNames = dependentAgents.map(a => `"${a.name}"`).join(', ');
                alert(
                    `无法删除标签 "${tagToDelete}"。\n\n` +
                    `它正在被以下 Agent 使用: ${agentNames}。\n\n` +
                    `请先从这些 Agent 中移除该标签，然后再试。`
                );
                return;
            }

            // 3. 确认删除
            if (!confirm(`确定要永久删除标签 "${tagToDelete}" 吗？此操作不可撤销。`)) {
                return;
            }

            // 4. [核心修改] 执行删除
            // 使用 ConfigManager 的 deleteTag API
            await this.configManager.deleteTag(tagToDelete);
            await this._loadTags();
            this._renderTags();
            
        } catch (error) {
            console.error('[TagsWidget] 删除标签时出错:', error);
            alert('删除标签时发生错误，请稍后再试。');
        }
    }
}
