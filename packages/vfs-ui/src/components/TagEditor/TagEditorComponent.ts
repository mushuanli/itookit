/**
 * @file vfs-ui/components/TagEditor/TagEditorComponent.ts
 */
import { escapeHTML, IAutocompleteSource, Suggestion } from '@itookit/common';

export interface TagEditorParams {
    container: HTMLElement;
    initialItems: string[];
    suggestionProvider: IAutocompleteSource;
    onSave: (items: string[]) => void;
    onCancel: () => void;
}

export class TagEditorComponent {
    private container: HTMLElement;
    private items: Set<string>;
    private provider: IAutocompleteSource;
    private onSave: (items: string[]) => void;
    private onCancel: () => void;
    private suggestions: Suggestion[] = [];
    private activeIndex = -1;

    private pillsEl!: HTMLElement;
    private inputEl!: HTMLInputElement;
    private suggestionsEl!: HTMLElement;

    constructor({ container, initialItems, suggestionProvider, onSave, onCancel }: TagEditorParams) {
        if (!suggestionProvider?.getSuggestions) {
            throw new Error("TagEditorComponent requires a valid suggestionProvider");
        }
        this.container = container;
        this.items = new Set(initialItems);
        this.provider = suggestionProvider;
        this.onSave = onSave;
        this.onCancel = onCancel;
    }

    init(): void {
        this.render();
        this.bindEvents();
        this.items.forEach(item => this.addPill(item));
        this.inputEl.focus();
    }

    private bindEvents(): void {
        this.container.addEventListener('keydown', this.handleKeyDown);
        this.inputEl.addEventListener('input', this.handleInput);
        this.container.addEventListener('click', this.handleClick);
    }

    private handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;

        if (target.closest('.mdx-tag-editor__remove-btn')) {
            e.stopPropagation();
            const pill = target.closest('.mdx-tag-editor__pill') as HTMLElement;
            if (pill?.dataset.item) this.removeItem(pill.dataset.item);
            return;
        }

        const suggestion = target.closest('.mdx-tag-editor__suggestion') as HTMLElement;
        if (suggestion?.dataset.item) {
            e.stopPropagation();
            this.addItem(suggestion.dataset.item);
            this.clearSuggestions();
            this.inputEl.value = '';
            return;
        }

        const action = (target.closest('.mdx-tag-editor__btn') as HTMLElement)?.dataset.action;
        if (action === 'save') this.onSave(this.getItems());
        else if (action === 'cancel') this.onCancel();
    };

    private handleInput = async (): Promise<void> => {
        const query = this.inputEl.value;
        if (query) {
            const all = await this.provider.getSuggestions(query);
            this.suggestions = all.filter(s => !this.items.has(s.label));
        } else {
            this.suggestions = [];
        }
        this.activeIndex = -1;
        this.renderSuggestions();
    };

    private handleKeyDown = (e: KeyboardEvent): void => {
        if (e.target !== this.inputEl) return;

        const hasSuggestions = this.suggestions.length > 0;

        switch (e.key) {
            case 'Enter':
            case ',':
                e.preventDefault();
                if (hasSuggestions && this.activeIndex > -1) {
                    this.addItem(this.suggestions[this.activeIndex].label);
                } else if (this.inputEl.value.trim()) {
                    this.addItem(this.inputEl.value.trim());
                }
                this.inputEl.value = '';
                this.clearSuggestions();
                break;
            case 'Backspace':
                if (!this.inputEl.value && this.items.size) {
                    this.removeItem([...this.items].pop()!);
                }
                break;
            case 'ArrowDown':
                if (hasSuggestions) {
                    e.preventDefault();
                    this.activeIndex = (this.activeIndex + 1) % this.suggestions.length;
                    this.renderSuggestions();
                }
                break;
            case 'ArrowUp':
                if (hasSuggestions) {
                    e.preventDefault();
                    this.activeIndex = (this.activeIndex - 1 + this.suggestions.length) % this.suggestions.length;
                    this.renderSuggestions();
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.suggestions.length ? this.clearSuggestions() : this.onCancel();
                break;
        }
    };

    private addItem(label: string): void {
        const item = label.trim();
        if (!item || this.items.has(item)) {
            this.inputEl.value = '';
            return;
        }
        this.items.add(item);
        this.addPill(item);
        this.inputEl.focus();
    }

    private removeItem(item: string): void {
        this.items.delete(item);
        this.pillsEl.querySelector(`[data-item="${escapeHTML(item)}"]`)?.remove();
        this.inputEl.focus();
    }

    private addPill(item: string): void {
        const pill = document.createElement('li');
        pill.className = 'mdx-tag-editor__pill';
        pill.dataset.item = item;
        pill.innerHTML = `<span>${escapeHTML(item)}</span><button type="button" class="mdx-tag-editor__remove-btn">&times;</button>`;
        this.pillsEl.insertBefore(pill, this.pillsEl.querySelector('.mdx-tag-editor__input-wrapper'));
    }

    private clearSuggestions(): void {
        this.suggestions = [];
        this.activeIndex = -1;
        this.renderSuggestions();
    }

    private renderSuggestions(): void {
        if (!this.suggestions.length) {
            this.suggestionsEl.style.display = 'none';
            return;
        }
        this.suggestionsEl.innerHTML = this.suggestions.map((s, i) =>
            `<li class="mdx-tag-editor__suggestion ${i === this.activeIndex ? 'is-active' : ''}" data-item="${escapeHTML(s.label)}">${escapeHTML(s.label)}</li>`
        ).join('');
        this.suggestionsEl.style.display = 'block';
    }

    private render(): void {
        this.container.innerHTML = `
            <ul class="mdx-tag-editor__pills">
                <li class="mdx-tag-editor__input-wrapper">
                    <input type="text" class="mdx-tag-editor__input" placeholder="Add tag..." autocomplete="off">
                </li>
            </ul>
            <ul class="mdx-tag-editor__suggestions"></ul>
            <div class="mdx-tag-editor__footer">
                <button type="button" class="mdx-tag-editor__btn mdx-tag-editor__btn--primary" data-action="save">Save</button>
                <button type="button" class="mdx-tag-editor__btn" data-action="cancel">Cancel</button>
            </div>`;
        this.pillsEl = this.container.querySelector('.mdx-tag-editor__pills')!;
        this.inputEl = this.container.querySelector('.mdx-tag-editor__input')!;
        this.suggestionsEl = this.container.querySelector('.mdx-tag-editor__suggestions')!;
    }

    getItems(): string[] {
        const last = this.inputEl?.value.trim();
        if (last && !this.items.has(last)) this.items.add(last);
        return [...this.items];
    }
}
