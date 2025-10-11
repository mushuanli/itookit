// #common/components/TagEditor/TagEditorComponent.js
// [TAGS-AUTOCOMPLETE]

// [重构] 不再导入 BaseComponent
import { escapeHTML } from '../../utils/utils.js';

/**
 * 一个可复用、自包含的弹出框组件，用于编辑带有自动补全功能项目列表（例如：标签）。
 * 它与任何特定数据源解耦，并通过 onSave/onCancel 回调函数来通信其结果。
 *
 * @example
 * const provider = new MySuggestionProvider();
 * const editor = new TagEditorComponent({
 *   container: document.getElementById('editor-container'),
 *   initialItems: ['react', 'typescript'],
 *   suggestionProvider: provider,
 *   onSave: (newItems) => console.log('Saved:', newItems),
 *   onCancel: () => console.log('Cancelled'),
 * });
 * editor.init();
 */
// [重构] 移除继承 extends BaseComponent

import './TagEditorComponent.css';
export class TagEditorComponent {
    /**
     * @param {object} params
     * @param {HTMLElement} params.container - 用于渲染编辑器的 DOM 元素。
     * @param {string[]} params.initialItems - 初始的项目集合（例如：标签）。
     * @param {import('../../interfaces/IAutocompleteProvider.js').IAutocompleteProvider} params.suggestionProvider - 提供自动补全建议的对象。
     * @param {(newItems: string[]) => void} params.onSave - 当用户点击保存按钮时执行的回调函数。
     * @param {() => void} params.onCancel - 当用户点击取消按钮或按下 Escape 键时执行的回调函数。
     */
    constructor(params) {
        // [重构] 移除 super() 调用，因为不再有父类
        if (!params.suggestionProvider || typeof params.suggestionProvider.getSuggestions !== 'function') {
            throw new Error("TagEditorComponent 需要一个有效的 suggestionProvider，且该 provider 必须包含 'getSuggestions' 方法。");
        }
        
        this.container = params.container; // [重构] 直接赋值 container
        this.items = new Set(params.initialItems);
        this.suggestionProvider = params.suggestionProvider;
        this.onSave = params.onSave;
        this.onCancel = params.onCancel;

        // 内部组件状态
        this.suggestions = [];
        this.activeIndex = -1;

        // [重构] 缓存对关键 DOM 元素的引用，这些元素在初始化后将保持不变
        this.pillsContainerEl = null;
        this.inputWrapperEl = null;
        this.inputEl = null;
        this.suggestionsListEl = null;
    }

    /**
     * 渲染组件并附加事件监听器。
     * 这个方法应该在实例化之后调用。
     */
    init() {
        this.render(); // 构建一次骨架
        this._bindEvents();
        this._renderInitialPills(); // 渲染初始标签
        this.inputEl.focus();
    }

    _bindEvents() {
        // [修改] 事件监听器现在可以直接附加到更具体的元素上，或继续使用委托
        this.container.addEventListener('keydown', this._handleKeyDown);
        this.inputEl.addEventListener('input', this._handleInput); // 监听 input 自身
        this.container.addEventListener('click', this._handleClick);
    }

    _handleClick = (e) => {
        const removeBtn = e.target.closest('.mdx-tag-editor__remove-btn');
        if (removeBtn) {
            // [核心修复] 停止事件冒泡，防止触发外部的 "click-outside" 监听器
            e.stopPropagation(); 
            
            const pillEl = removeBtn.closest('.mdx-tag-editor__pill');
            const item = pillEl.dataset.item;
            this._removeItem(item);
            return; // 处理完毕，提前返回
        }

        const suggestionItem = e.target.closest('.mdx-tag-editor__suggestion');
        if (suggestionItem) {
            // [防御性修复] 同样停止冒泡
            e.stopPropagation();

            this._addItem(suggestionItem.dataset.item);
            this._clearSuggestions();
            this.inputEl.value = '';
            return; // 处理完毕，提前返回
        }

        const actionBtn = e.target.closest('.mdx-tag-editor__btn');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'save' && typeof this.onSave === 'function') {
                this.onSave(this.getItems());
            } else if (action === 'cancel' && typeof this.onCancel === 'function') {
                this.onCancel();
            }
        }
    }

    _handleInput = async (e) => {
        const query = this.inputEl.value;
        if (query) {
            this.suggestions = await this.suggestionProvider.getSuggestions(query);
            // 不显示已经添加的建议
            this.suggestions = this.suggestions.filter(s => !this.items.has(s.label));
        } else {
            this.suggestions = [];
        }
        this.activeIndex = -1; // 在新输入时重置选择
        this._renderSuggestions();
    }
    
    _handleKeyDown = (e) => {
        // [修改] 只有当事件源是输入框时才处理
        if (e.target !== this.inputEl) return;
        
        const hasSuggestions = this.suggestions.length > 0;

        switch (e.key) {
            case 'Enter':
            case ',':
                e.preventDefault();
                if (hasSuggestions && this.activeIndex > -1) {
                    this._addItem(this.suggestions[this.activeIndex].label);
                } else if (this.inputEl.value.trim()) {
                    this._addItem(this.inputEl.value.trim());
                }
                // [修复] 添加后清空输入和建议
                this.inputEl.value = '';
                this._clearSuggestions();
                break;
            case 'Backspace':
                if (this.inputEl.value === '' && this.items.size > 0) {
                    const lastItem = Array.from(this.items).pop();
                    this._removeItem(lastItem);
                }
                break;
            case 'ArrowDown':
                if (hasSuggestions) {
                    e.preventDefault();
                    this.activeIndex = (this.activeIndex + 1) % this.suggestions.length;
                    this._renderSuggestions();
                }
                break;
            case 'ArrowUp':
                if (hasSuggestions) {
                    e.preventDefault();
                    this.activeIndex = (this.activeIndex - 1 + this.suggestions.length) % this.suggestions.length;
                    this._renderSuggestions();
                }
                break;
            case 'Escape':
                e.preventDefault();
                if (this.suggestions.length > 0) {
                    this._clearSuggestions();
                } else if (typeof this.onCancel === 'function') {
                    this.onCancel();
                }
                break;
        }
    }
    
    /** [重构] 核心业务逻辑，只更新状态并调用 DOM 操作 */
    _addItem(itemLabel) {
        if (!itemLabel) return;
        const trimmedItem = itemLabel.trim();
        if (trimmedItem.length === 0 || this.items.has(trimmedItem)) {
            // 如果标签已存在，则什么都不做
            this.inputEl.value = '';
            return;
        };

        this.items.add(trimmedItem);
        this._addPill(trimmedItem); // 调用增量 DOM 更新
        this.inputEl.focus();
    }
    
    /** [重构] 核心业务逻辑，只更新状态并调用 DOM 操作 */
    _removeItem(item) {
        this.items.delete(item);
        const pillToRemove = this.pillsContainerEl.querySelector(`[data-item="${escapeHTML(item)}"]`);
        if (pillToRemove) {
            pillToRemove.remove(); // 直接从 DOM 中移除
        }
        this.inputEl.focus();
    }

    /** [新增] 增量 DOM 更新：只添加一个新的 pill */
    _addPill(item) {
        const pillEl = document.createElement('li');
        pillEl.className = 'mdx-tag-editor__pill';
        pillEl.dataset.item = item;
        pillEl.innerHTML = `
            <span>${escapeHTML(item)}</span>
            <button type="button" class="mdx-tag-editor__remove-btn" aria-label="Remove ${escapeHTML(item)}">&times;</button>
        `;
        // 在输入框之前插入新的 pill
        this.pillsContainerEl.insertBefore(pillEl, this.inputWrapperEl);
    }
    
    _clearSuggestions() {
        this.suggestions = [];
        this.activeIndex = -1;
        this._renderSuggestions();
    }
    
    _renderSuggestions() {
        if (this.suggestions.length === 0) {
            this.suggestionsListEl.style.display = 'none';
            return;
        }

        this.suggestionsListEl.innerHTML = this.suggestions.map((s, index) =>
            `<li class="mdx-tag-editor__suggestion ${index === this.activeIndex ? 'is-active' : ''}" data-item="${escapeHTML(s.label)}">
                ${escapeHTML(s.label)}
            </li>`
        ).join('');
        this.suggestionsListEl.style.display = 'block';
    }

    /** [新增] 只渲染初始的 pills */
    _renderInitialPills() {
        Array.from(this.items).forEach(item => this._addPill(item));
    }
    
    /** [重构] render 方法现在只构建一次组件的骨架 */
    render() {
        this.container.innerHTML = `
            <ul class="mdx-tag-editor__pills" data-role="pills-container">
            <li class="mdx-tag-editor__input-wrapper" data-role="input-wrapper">
                    <input type="text" class="mdx-tag-editor__input" placeholder="添加标签..." autocomplete="off">
                </li>
            </ul>
            <ul class="mdx-tag-editor__suggestions" data-role="suggestions-list"></ul>
            <div class="mdx-tag-editor__footer">
                <button type="button" class="mdx-tag-editor__btn mdx-tag-editor__btn--primary" data-action="save">保存</button>
                <button type="button" class="mdx-tag-editor__btn" data-action="cancel">取消</button>
            </div>
        `;
        // [重构] 缓存对关键元素的引用
        this.pillsContainerEl = this.container.querySelector('[data-role="pills-container"]');
        this.inputWrapperEl = this.container.querySelector('[data-role="input-wrapper"]');
        this.inputEl = this.container.querySelector('.mdx-tag-editor__input');
        this.suggestionsListEl = this.container.querySelector('[data-role="suggestions-list"]');
    }

    /**
     * 从编辑器的状态中获取最终的项目（标签）列表。
     * @returns {string[]} 当前项目的数组。
     */
    getItems() {
        // 我们同时检查输入框中是否有任何未提交的标签
        const lastInput = this.inputEl ? this.inputEl.value.trim() : '';
        if (lastInput) {
            this.items.add(lastInput);
        }
        return Array.from(this.items);
    }
}
