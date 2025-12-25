// @file llm-ui/components/ChatInput.ts

export interface ChatInputOptions {
    onSend: (text: string, files: File[], executorId: string) => Promise<void>;
    onStop: () => void;
    onExecutorChange?: (executorId: string) => void;
    initialAgents?: ExecutorOption[]; 

    /** [新增] 上传限制配置 */
    uploadConfig?: {
        accept?: string[]; // e.g. ['.pdf', 'image/*']
        maxSize?: number;  // bytes, default 10MB
    };
}

export interface ExecutorOption {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
}

export class ChatInput {
    private textarea!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;
    private stopBtn!: HTMLButtonElement;
    private attachBtn!: HTMLButtonElement;
    private executorSelect!: HTMLSelectElement;
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    
    private loading = false;
    private files: File[] = [];

    // 默认 10MB
    private readonly DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        this.render();
        this.bindEvents();

        // ✨ 2. 新增初始化逻辑 (在 bindEvents 之后)
        // 如果传入了初始列表，立即渲染
        if (this.options.initialAgents && this.options.initialAgents.length > 0) {
            this.updateExecutors(this.options.initialAgents);
        } else {
            // 否则渲染一个默认的
            this.updateExecutors([{ id: 'default', name: 'Assistant', category: 'System' }]);
        }
    }

    private render() {
        // 使用 BEM 结构重构 DOM
        // 1. 处理 accept 属性
        const acceptAttr = this.options.uploadConfig?.accept?.join(',') || '';
        this.container.innerHTML = `
            <div class="llm-input">
                <!-- 左侧：执行器选择 -->
                <div class="llm-input__executor-wrapper">
                    <select class="llm-input__executor-select" title="Select Agent/Executor">
                        <option value="default">🤖 Assistant</option>
                    </select>
                </div>

                <!-- 中间：输入区域 + 附件预览 -->
                <div class="llm-input__field-wrapper">
                    <div class="llm-input__attachments" style="display:none"></div>
                    <textarea 
                        class="llm-input__textarea" 
                        placeholder="Message... (Shift+Enter for new line)" 
                        rows="1"
                    ></textarea>
                </div>

                <!-- 右侧：操作按钮 -->
                <div class="llm-input__actions">
                    <button class="llm-input__btn llm-input__btn--attach" title="Attach File">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                    </button>
                    
                    <button class="llm-input__btn llm-input__btn--send" title="Send">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                    
                    <button class="llm-input__btn llm-input__btn--stop" title="Stop Generation" style="display:none;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                    </button>
                </div>

                <!-- 隐藏的文件输入框，应用 accept 属性 -->
                <input type="file" multiple 
                       accept="${acceptAttr}"
                       style="display:none;" 
                       id="llm-ui-hidden-file-input">
            </div>
        `;

        // 绑定元素引用
        this.textarea = this.container.querySelector('.llm-input__textarea')!;
        this.sendBtn = this.container.querySelector('.llm-input__btn--send')!;
        this.stopBtn = this.container.querySelector('.llm-input__btn--stop')!;
        this.attachBtn = this.container.querySelector('.llm-input__btn--attach')!;
        this.executorSelect = this.container.querySelector('.llm-input__executor-select')!;
        this.fileInput = this.container.querySelector('#llm-ui-hidden-file-input')!;
        this.attachmentContainer = this.container.querySelector('.llm-input__attachments')!;
    }

    private bindEvents() {
        // 1. 自动高度调整
        const adjustHeight = () => {
            this.textarea.style.height = 'auto';
            const newHeight = Math.min(this.textarea.scrollHeight, 200); // Max height 200px
            this.textarea.style.height = `${newHeight}px`;
        };
        this.textarea.addEventListener('input', adjustHeight);

        // 2. 键盘事件
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        // 3. 按钮事件
        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());
        
        // 4. 附件处理
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files) {
                // [修改] 调用处理函数进行校验
                this.handleFilesSelection(Array.from(this.fileInput.files));
                this.fileInput.value = ''; // Reset
            }
        });

        // 5. Executor 选择变化
        this.executorSelect.addEventListener('change', () => {
            this.options.onExecutorChange?.(this.executorSelect.value);
        });
    }

    /**
     * [新增] 处理文件选择并校验
     */
    private handleFilesSelection(files: File[]) {
        const maxSize = this.options.uploadConfig?.maxSize ?? this.DEFAULT_MAX_SIZE;
        const validFiles: File[] = [];

        for (const file of files) {
            // 校验大小
            if (file.size > maxSize) {
                const sizeMB = (maxSize / (1024 * 1024)).toFixed(1);
                console.warn(`File ${file.name} is too large. Max: ${sizeMB}MB`);
                // 这里可以引入 Toast，如果环境支持
                alert(`文件 "${file.name}" 超过大小限制 (${sizeMB}MB)`);
                continue; 
            }
            
            // 校验类型 (input accept 已经做了基础过滤，这里可不做深度校验)
            validFiles.push(file);
        }

        if (validFiles.length > 0) {
            this.addFiles(validFiles);
        }
    }

    /**
     * 更新执行器列表，支持分组
     */
    public updateExecutors(executors: ExecutorOption[], activeId?: string) {
        //this.executors = executors;
        
        // 分组逻辑
        const groups: Record<string, ExecutorOption[]> = {};
        const uncategorized: ExecutorOption[] = [];

        executors.forEach(e => {
            if (e.category) {
                if (!groups[e.category]) groups[e.category] = [];
                groups[e.category].push(e);
            } else {
                uncategorized.push(e);
            }
        });

        let html = '';

        // 1. 未分类 (Default agents)
        if (uncategorized.length > 0) {
            html += uncategorized.map(e => this.renderOption(e)).join('');
        }

        // 2. 分类组
        Object.entries(groups).forEach(([category, items]) => {
            html += `<optgroup label="${category}">`;
            html += items.map(e => this.renderOption(e)).join('');
            html += `</optgroup>`;
        });

        this.executorSelect.innerHTML = html;
        
        if (activeId) {
            this.executorSelect.value = activeId;
        }
    }

    private renderOption(e: ExecutorOption): string {
        const icon = e.icon ? `${e.icon} ` : '';
        return `<option value="${e.id}">${icon}${e.name}</option>`;
    }

    private addFiles(newFiles: File[]) {
        this.files = [...this.files, ...newFiles];
        this.renderAttachments();
    }

    private removeFile(index: number) {
        this.files.splice(index, 1);
        this.renderAttachments();
    }

    private renderAttachments() {
        if (this.files.length === 0) {
            this.attachmentContainer.style.display = 'none';
            return;
        }
        this.attachmentContainer.style.display = 'flex';
        this.attachmentContainer.innerHTML = this.files.map((f, i) => `
            <div class="llm-input__attachment-tag">
                <span>📄 ${f.name}</span>
                <span style="cursor:pointer;margin-left:4px;" data-index="${i}">×</span>
            </div>
        `).join('');

        this.attachmentContainer.querySelectorAll('span[data-index]').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt((e.target as HTMLElement).dataset.index!);
                this.removeFile(idx);
            });
        });
    }

    private async triggerSend() {
        const text = this.textarea.value.trim();
        if ((!text && this.files.length === 0) || this.loading) return;

        const currentExecutor = this.executorSelect.value;
        const currentFiles = [...this.files];

        // Reset UI
        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.files = [];
        this.renderAttachments();
        
        await this.options.onSend(text, currentFiles, currentExecutor); 
    }

    setLoading(loading: boolean) {
        this.loading = loading;
        this.sendBtn.style.display = loading ? 'none' : 'flex';
        this.stopBtn.style.display = loading ? 'flex' : 'none';
        this.textarea.disabled = loading;
        this.executorSelect.disabled = loading;
        this.attachBtn.disabled = loading;
    }

    focus() {
        this.textarea?.focus();
    }

    // ✨ [新增] 销毁方法
    destroy() {
        this.container.innerHTML = '';
        this.files = [];
    }

    // ✨ [新增] 获取当前选中的执行器
    getSelectedExecutor(): string {
        return this.executorSelect?.value || 'default';
    }

    setInput(text: string) {
        if (this.textarea) {
            this.textarea.value = text;
            this.textarea.dispatchEvent(new Event('input'));
        }
    }

    // [新增] 获取当前值
    getValue(): string {
        return this.textarea ? this.textarea.value : '';
    }
    
    // [新增] 在光标处插入文本 (用于 AssetManager 插入)
    insertAtCursor(text: string) {
        if (!this.textarea) return;
        
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const current = this.textarea.value;
        
        const newValue = current.substring(0, start) + text + current.substring(end);
        
        this.textarea.value = newValue;
        this.textarea.selectionStart = this.textarea.selectionEnd = start + text.length;
        this.textarea.focus();
        this.textarea.dispatchEvent(new Event('input'));
    }
}
