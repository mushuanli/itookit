// src/anki/components/EditorComponent.js

// 修复防抖函数的 this 绑定问题
const debounce = (func, delay, context) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
};

export class EditorComponent {
    constructor(store) {
        this.store = store;
        this.element = document.getElementById('anki_editor');
        this.container = document.getElementById('anki_editorContainer');
        
        // 防止 store 更新时触发不必要的 input 事件
        this.isUpdatingInternally = false;
        
        this.setupEventListeners();
        
        this.unsubscribe = store.subscribe(
            this.handleStateChange.bind(this),
            ['editorContent', 'viewMode', 'editorScrollRatio', 'pendingEditorSelection']
        );
    }
  
    setupEventListeners() {
        // 使用防抖处理输入，避免过于频繁地更新状态和触发预览
        this.element.addEventListener('input', debounce((e) => {
            if (this.isUpdatingInternally) return;
            // 记录撤销状态，并更新编辑器内容
            this.store.recordUndoState(this.store.getState().editorContent);
            this.store.setState({ editorContent: e.target.value });
            this.store.updatePreview(); // 请求更新预览
        }, 300, this));
      
        // 处理快捷键，例如保存
        this.element.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 's': e.preventDefault(); this.store.saveCurrentSession(); break;
                    case 'z': e.preventDefault(); this.store.undo(); break;
                    case 'y': e.preventDefault(); this.store.redo(); break;
                }
            }
        });

        // [重构] 统一的选区事件监听
        // 监听鼠标释放和键盘释放，同步更新 store
        this.element.addEventListener('mouseup', () => this.checkAndSaveSelection('mouseup'));
        this.element.addEventListener('keyup', () => this.checkAndSaveSelection('keyup'));
        this.element.addEventListener('dblclick', () => this.checkAndSaveSelection('dblclick'));

        // 监听滚动事件，用于同步预览区
        this.element.addEventListener('scroll', () => {
             // 仅在编辑模式下，由编辑器的滚动驱动同步
            if (this.store.getState().viewMode === 'edit') {
                const editor = this.element;
                if (editor.scrollHeight > editor.clientHeight) {
                    const scrollRatio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
                    this.store.setScrollRatio(Math.min(1, Math.max(0, scrollRatio)));
                }
            }
        });
    }

    // [重构] 唯一的选区处理函数
    checkAndSaveSelection(source = 'unknown') {
        const start = this.element.selectionStart;
        const end = this.element.selectionEnd;
        const text = this.element.value.substring(start, end);
        const hasSelection = start !== end && text.trim().length > 0;

        // 直接更新 store，store 是唯一的数据源
        this.store.setState({ 
            editorSelection: { 
                start, 
                end, 
                text: hasSelection ? text.trim() : '', 
                hasSelection, 
                timestamp: Date.now() 
            }
        });
        
        if(hasSelection){
            console.log(`✅ [EditorComponent] Selection saved to store from ${source}`);
        }
    }

    handleStateChange(newState, oldState) {
        // [ADDED] 监听并处理来自预览区的选择请求
        if (newState.pendingEditorSelection && newState.pendingEditorSelection !== oldState.pendingEditorSelection) {
            const textToSelect = newState.pendingEditorSelection;
            // 查找时从当前光标位置开始，以优先匹配用户视野内的文本
            const startIndex = this.element.value.indexOf(textToSelect, this.element.selectionStart);
            
            if (startIndex !== -1) {
                const endIndex = startIndex + textToSelect.length;
                this.element.style.display = 'block'; 
                this.element.focus();
                this.element.setSelectionRange(startIndex, endIndex);
                
                // 智能滚动到选区中央
                const textBefore = this.element.value.substring(0, startIndex);
                const lineBreaks = textBefore.match(/\n/g);
                const lineNumber = lineBreaks ? lineBreaks.length : 0;
                const lineHeight = parseFloat(getComputedStyle(this.element).lineHeight) || 24; // 提供一个备用值
                this.element.scrollTop = (lineNumber * lineHeight) - (this.element.clientHeight / 2) + (lineHeight / 2);

                this.checkAndSaveSelection('programmatic_jump');
            } else {
                // 如果从当前位置找不到，再从头找一次作为后备
                const fallbackStartIndex = this.element.value.indexOf(textToSelect);
                if(fallbackStartIndex !== -1) {
                   this.element.focus();
                   this.element.setSelectionRange(fallbackStartIndex, fallbackStartIndex + textToSelect.length);
                   this.checkAndSaveSelection('programmatic_jump_fallback');
                }
            }
        }

        if (newState.editorContent !== oldState.editorContent && newState.editorContent !== this.element.value) {
            const cursorPos = this.element.selectionStart;
            this.isUpdatingInternally = true;
            this.element.value = newState.editorContent;
            this.element.setSelectionRange(cursorPos, cursorPos);
            this.isUpdatingInternally = false;
        }
      
        // 根据视图模式，控制编辑器和预览的显示/隐藏
        if (newState.viewMode !== oldState.viewMode) {
            this.element.style.display = newState.viewMode === 'edit' ? '' : 'none';
        }

        // 3. 同步滚动位置
        // 仅在视图切换到编辑模式时，根据 store 的比例设置滚动条
        if (newState.viewMode === 'edit' && oldState.viewMode === 'preview') {
             requestAnimationFrame(() => {
                const editor = this.element;
                if (editor.scrollHeight > editor.clientHeight) {
                    editor.scrollTop = newState.editorScrollRatio * (editor.scrollHeight - editor.clientHeight);
                }
            });
        }
    }
  
    // 在组件销毁时调用，以防止内存泄漏
    destroy() {
        this.unsubscribe();
    }
}
