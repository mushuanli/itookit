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
            <div class="llm-ui-chat-input">
                <div class="llm-ui-chat-input__toolbar">
                    <button class="llm-ui-btn-icon" title="Upload File" id="llm-ui-btn-upload">📎</button>
                </div>
                <div class="llm-ui-chat-input__body">
                    <textarea class="llm-ui-chat-input__textarea" placeholder="Message... (Shift+Enter for new line)" rows="1"></textarea>
                    <div class="llm-ui-chat-input__actions">
                        <button class="llm-ui-btn-send">➤</button>
                        <button class="llm-ui-btn-stop" style="display:none;">⏹</button>
                    </div>
                </div>
                <input type="file" multiple style="display:none;" id="llm-ui-hidden-file-input">
            </div>
        `;

        this.textarea = this.container.querySelector('textarea')!;
        this.sendBtn = this.container.querySelector('.llm-ui-btn-send')!;
        this.stopBtn = this.container.querySelector('.llm-ui-btn-stop')!;
        this.fileInput = this.container.querySelector('#llm-ui-hidden-file-input')!;
    }

    private bindEvents() {
        this.textarea.addEventListener('input', () => {
            this.textarea.style.height = 'auto';
            this.textarea.style.height = Math.min(this.textarea.scrollHeight, 200) + 'px';
        });

        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());
        
        this.container.querySelector('#llm-ui-btn-upload')?.addEventListener('click', () => {
            this.fileInput.click();
        });
    }

    private async triggerSend() {
        const text = this.textarea.value.trim();
        if (!text || this.loading) return;

        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        
        await this.options.onSend(text, []); 
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
