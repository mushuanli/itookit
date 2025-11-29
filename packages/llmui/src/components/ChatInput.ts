// @file llm-ui/components/ChatInput.ts

export interface ChatInputOptions {
    onSend: (text: string, files: File[]) => Promise<void>;
    onStop: () => void;
}

export class ChatInput {
    private textarea!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;
    private stopBtn!: HTMLButtonElement;
    private fileInput!: HTMLInputElement;
    private loading = false;

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        this.render();
        this.bindEvents();
    }

    private render() {
        this.container.innerHTML = `
            <div class="chat-input-wrapper">
                <div class="chat-toolbar">
                    <button class="tool-btn" title="Upload File" id="btn-upload">📎</button>
                    <!-- 可以在这里加 @ 提及功能触发器 -->
                </div>
                <div class="input-area">
                    <textarea placeholder="Message... (Shift+Enter for new line)" rows="1"></textarea>
                    <div class="action-buttons">
                        <button class="send-btn">➤</button>
                        <button class="stop-btn" style="display:none;">⏹</button>
                    </div>
                </div>
                <input type="file" multiple style="display:none;" id="hidden-file-input">
            </div>
        `;

        this.textarea = this.container.querySelector('textarea')!;
        this.sendBtn = this.container.querySelector('.send-btn')!;
        this.stopBtn = this.container.querySelector('.stop-btn')!;
        this.fileInput = this.container.querySelector('#hidden-file-input')!;
    }

    private bindEvents() {
        // Auto-resize
        this.textarea.addEventListener('input', () => {
            this.textarea.style.height = 'auto';
            this.textarea.style.height = Math.min(this.textarea.scrollHeight, 200) + 'px';
        });

        // Send on Enter
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());
        
        // File Upload
        this.container.querySelector('#btn-upload')?.addEventListener('click', () => {
            this.fileInput.click();
        });
    }

    private async triggerSend() {
        const text = this.textarea.value.trim();
        if (!text || this.loading) return;

        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        
        await this.options.onSend(text, []); // TODO: handle files
    }

    setLoading(loading: boolean) {
        this.loading = loading;
        this.sendBtn.style.display = loading ? 'none' : 'block';
        this.stopBtn.style.display = loading ? 'block' : 'none';
        this.textarea.disabled = loading;
    }

    focus() {
        this.textarea.focus();
    }
}
