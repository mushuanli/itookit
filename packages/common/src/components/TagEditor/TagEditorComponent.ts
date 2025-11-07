/**
 * @file common/components/TagEditor/TagEditorComponent.ts
 */
import './TagEditorComponent.css';

import { escapeHTML } from '../../utils/utils.js';
import { IAutocompleteProvider, Suggestion } from '../../interfaces/IAutocompleteProvider';

interface TagEditorParams {
    container: HTMLElement;
    initialItems: string[];
    suggestionProvider: IAutocompleteProvider;
    onSave: (newItems: string[]) => void;
    onCancel: () => void;
}

export class TagEditorComponent {
    private container: HTMLElement;
    private items: Set<string>;
    private suggestionProvider: IAutocompleteProvider;
    private onSave: (newItems: string[]) => void;
    private onCancel: () => void;

    private suggestions: Suggestion[] = [];
    private activeIndex: number = -1;

    private pillsContainerEl!: HTMLElement;
    private inputWrapperEl!: HTMLElement;
    private inputEl!: HTMLInputElement;
    private suggestionsListEl!: HTMLElement;

    constructor(params: TagEditorParams) {
        if (!params.suggestionProvider || typeof params.suggestionProvider.getSuggestions !== 'function') {
            throw new Error("TagEditorComponent requires a valid suggestionProvider with a 'getSuggestions' method.");
        }
        
        this.container = params.container;
        this.items = new Set(params.initialItems);
        this.suggestionProvider = params.suggestionProvider;
        this.onSave = params.onSave;
        this.onCancel = params.onCancel;
    }

    public init(): void {
        this.render();
        this._bindEvents();
        this._renderInitialPills();
        this.inputEl.focus();
    }

    private _bindEvents(): void {
        this.container.addEventListener('keydown', this._handleKeyDown);
        this.inputEl.addEventListener('input', this._handleInput);
        this.container.addEventListener('click', this._handleClick);
    }
    
    private _handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;

        const removeBtn = target.closest('.mdx-tag-editor__remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            const pillEl = removeBtn.closest('.mdx-tag-editor__pill') as HTMLElement;
            if (pillEl) this._removeItem(pillEl.dataset.item!);
            return;
        }

        const suggestionItem = target.closest('.mdx-tag-editor__suggestion') as HTMLElement;
        if (suggestionItem) {
            e.stopPropagation();
            this._addItem(suggestionItem.dataset.item!);
            this._clearSuggestions();
            this.inputEl.value = '';
            return;
        }

        const actionBtn = target.closest('.mdx-tag-editor__btn') as HTMLElement;
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'save') {
                this.onSave(this.getItems());
            } else if (action === 'cancel') {
                this.onCancel();
            }
        }
    };

    private _handleInput = async (e: Event): Promise<void> => {
        const query = this.inputEl.value;
        if (query) {
            const allSuggestions = await this.suggestionProvider.getSuggestions(query);
            this.suggestions = allSuggestions.filter(s => !this.items.has(s.label));
        } else {
            this.suggestions = [];
        }
        this.activeIndex = -1;
        this._renderSuggestions();
    };

    private _handleKeyDown = (e: KeyboardEvent): void => {
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
                this.inputEl.value = '';
                this._clearSuggestions();
                break;
            case 'Backspace':
                if (this.inputEl.value === '' && this.items.size > 0) {
                    const lastItem = Array.from(this.items).pop()!;
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
                } else {
                    this.onCancel();
                }
                break;
        }
    };
    
    private _addItem(itemLabel: string): void {
        if (!itemLabel) return;
        const trimmedItem = itemLabel.trim();
        if (trimmedItem.length === 0 || this.items.has(trimmedItem)) {
            this.inputEl.value = '';
            return;
        }
        this.items.add(trimmedItem);
        this._addPill(trimmedItem);
        this.inputEl.focus();
    }
    
    private _removeItem(item: string): void {
        this.items.delete(item);
        const pillToRemove = this.pillsContainerEl.querySelector(`[data-item="${escapeHTML(item)}"]`);
        if (pillToRemove) {
            pillToRemove.remove();
        }
        this.inputEl.focus();
    }

    private _addPill(item: string): void {
        const pillEl = document.createElement('li');
        pillEl.className = 'mdx-tag-editor__pill';
        pillEl.dataset.item = item;
        pillEl.innerHTML = `
            <span>${escapeHTML(item)}</span>
            <button type="button" class="mdx-tag-editor__remove-btn" aria-label="Remove ${escapeHTML(item)}">&times;</button>
        `;
        this.pillsContainerEl.insertBefore(pillEl, this.inputWrapperEl);
    }
    
    private _clearSuggestions(): void {
        this.suggestions = [];
        this.activeIndex = -1;
        this._renderSuggestions();
    }
    
    private _renderSuggestions(): void {
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

    private _renderInitialPills(): void {
        Array.from(this.items).forEach(item => this._addPill(item));
    }
    
    private render(): void {
        this.container.innerHTML = `
            <ul class="mdx-tag-editor__pills" data-role="pills-container">
                <li class="mdx-tag-editor__input-wrapper" data-role="input-wrapper">
                    <input type="text" class="mdx-tag-editor__input" placeholder="Add tag..." autocomplete="off">
                </li>
            </ul>
            <ul class="mdx-tag-editor__suggestions" data-role="suggestions-list"></ul>
            <div class="mdx-tag-editor__footer">
                <button type="button" class="mdx-tag-editor__btn mdx-tag-editor__btn--primary" data-action="save">Save</button>
                <button type="button" class="mdx-tag-editor__btn" data-action="cancel">Cancel</button>
            </div>
        `;
        this.pillsContainerEl = this.container.querySelector('[data-role="pills-container"]')!;
        this.inputWrapperEl = this.container.querySelector('[data-role="input-wrapper"]')!;
        this.inputEl = this.container.querySelector('.mdx-tag-editor__input')!;
        this.suggestionsListEl = this.container.querySelector('[data-role="suggestions-list"]')!;
    }

    public getItems(): string[] {
        const lastInput = this.inputEl ? this.inputEl.value.trim() : '';
        if (lastInput && !this.items.has(lastInput)) {
            this.items.add(lastInput);
        }
        return Array.from(this.items);
    }
}
