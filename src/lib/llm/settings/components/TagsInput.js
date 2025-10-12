/**
 * @file #llm/settings/components/TagsInput.js
 * @description A reusable UI component for tag input with autocomplete.
 */
export class TagsInput {
    constructor(element, { initialTags = [], allTags = [], onChange = () => {} }) {
        this.element = element;
        this.currentTags = new Set(initialTags);
        this.allTags = allTags;
        this.onChange = onChange;
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
        this.ui.list.innerHTML = '';
        this.currentTags.forEach(tag => {
            const li = document.createElement('li');
            li.textContent = tag;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.onclick = () => this.removeTag(tag);
            li.appendChild(removeBtn);
            this.ui.list.appendChild(li);
        });
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
        const filtered = this.allTags.filter(t => t.toLowerCase().includes(value) && !this.currentTags.has(t));
        if (filtered.length === 0) {
            this.hideSuggestions();
            return;
        }
        this.ui.suggestions.innerHTML = filtered.map(t => `<li>${t}</li>`).join('');
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
        this.ui.input.addEventListener('input', () => this.showSuggestions());
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
}
