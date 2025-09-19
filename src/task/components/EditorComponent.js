// src/task/components/EditorComponent.js
export class EditorComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            editor: document.getElementById('task_yamlEditor'),
        };
        
        // 添加选区状态
        this.currentSelection = { start: 0, end: 0, text: '' };
        
        this.unsubscribe = store.subscribe(this.render.bind(this), ['markdownContent', 'selectedTaskId']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.editor.addEventListener('input', e => this.store.setState({ markdownContent: e.target.value }));
        
        // ++++++++++++++++ 新增代码开始 ++++++++++++++++
        this.dom.editor.addEventListener('select', () => this.updateSelection());
        this.dom.editor.addEventListener('keyup', () => this.updateSelection());
        this.dom.editor.addEventListener('mouseup', () => this.updateSelection());
        this.dom.editor.addEventListener('focus', () => this.updateSelection());
        // ++++++++++++++++ 新增代码结束 ++++++++++++++++
    }

    updateSelection() {
        const start = this.dom.editor.selectionStart;
        const end = this.dom.editor.selectionEnd;
        const text = this.dom.editor.value.substring(start, end);

        this.store.setState({ 
            editorSelection: {
                start,
                end,
                text: text.trim(),
                hasSelection: start !== end
            }
        });
    }

    render({ markdownContent, selectedTaskId }) {
        if (this.dom.editor.value !== markdownContent) {
            this.dom.editor.value = markdownContent;
        }
        // Disable editor if no task is selected (unless it's a new one)
        this.dom.editor.disabled = !selectedTaskId;
    }

    destroy() { this.unsubscribe(); }
}
