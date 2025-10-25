/**
 * @file #llm/settings/components/TagsInput.js
 * @description A reusable UI component for tag input with autocomplete.
 */
import { debounce } from '../../../common/utils/utils.js';

export class TagsInput {
    constructor(element, { initialTags = [], allTags = [], onChange = () => {} }) {
        this.element = element;
        this.currentTags = new Set(initialTags);
        this.allTags = allTags;
        this.onChange = onChange;
        
        // +++ 性能优化：防抖建议列表更新 +++
        this.debouncedShowSuggestions = debounce(this.showSuggestions.bind(this), 150);
        
        this.render();
        this.attachEventListeners();
    }

    render() {
        this.element.innerHTML = `
            <div class="tags-input-container">
                <ul class="tags-list"></ul>
                <input type="text" class="tags-input-field" placeholder="Add a tag...">
            </div>
            <ul class="autocomplete-suggestions"></ul>
        `;
        this.ui = {
            list: this.element.querySelector('.tags-list'),
            input: this.element.querySelector('.tags-input-field'),
            suggestions: this.element.querySelector('.autocomplete-suggestions'),
        };
        this.renderTags();
    }

    renderTags() {
        // +++ 使用 DocumentFragment 减少重排 +++
        const fragment = document.createDocumentFragment();
        
        this.currentTags.forEach(tag => {
            const li = document.createElement('li');
            li.textContent = tag;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.onclick = () => this.removeTag(tag);
            li.appendChild(removeBtn);
            fragment.appendChild(li);
        });
        
        this.ui.list.innerHTML = '';
        this.ui.list.appendChild(fragment);
    }
    
    addTag(tag) {
        tag = tag.trim();
        if (tag && !this.currentTags.has(tag)) {
            this.currentTags.add(tag);
            this.renderTags();
            this.onChange(Array.from(this.currentTags));
        }
        this.ui.input.value = '';
        this.hideSuggestions();
    }

    removeTag(tag) {
        this.currentTags.delete(tag);
        this.renderTags();
        this.onChange(Array.from(this.currentTags));
    }
    
    showSuggestions() {
        const value = this.ui.input.value.toLowerCase();
        if (!value) {
            this.hideSuggestions();
            return;
        }
        
        const filtered = this.allTags.filter(t => 
            t.toLowerCase().includes(value) && !this.currentTags.has(t)
        );
        
        if (filtered.length === 0) {
            this.hideSuggestions();
            return;
        }
        
        // +++ 使用 DocumentFragment +++
        const fragment = document.createDocumentFragment();
        filtered.forEach(tag => {
            const li = document.createElement('li');
            li.textContent = tag;
            fragment.appendChild(li);
        });
        
        this.ui.suggestions.innerHTML = '';
        this.ui.suggestions.appendChild(fragment);
        this.ui.suggestions.style.display = 'block';
    }

    hideSuggestions() {
        this.ui.suggestions.style.display = 'none';
    }

    attachEventListeners() {
        this.ui.input.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                this.addTag(this.ui.input.value);
            }
        });
        
        // +++ 使用防抖版本 +++
        this.ui.input.addEventListener('input', this.debouncedShowSuggestions);
        
        this.ui.suggestions.addEventListener('click', e => {
            if (e.target.tagName === 'LI') {
                this.addTag(e.target.textContent);
            }
        });
        // Hide suggestions when clicking outside
        document.addEventListener('click', e => {
            if (!this.element.contains(e.target)) this.hideSuggestions();
        });
    }

    updateAllTags(newAllTags) {
        this.allTags = newAllTags;
    }
    
    // +++ 清理方法 +++
    destroy() {
        this.debouncedShowSuggestions.cancel?.();
    }
}
