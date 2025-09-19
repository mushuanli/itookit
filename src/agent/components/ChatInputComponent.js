// src/agent/components/ChatInputComponent.js
import { escapeHTML } from '../../common/utils.js';

export class ChatInputComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            input: document.getElementById('agent_chatInput'),
            sendBtn: document.getElementById('agent_sendMessageBtn'),
            // [新增] 附件相关 DOM
            attachFileBtn: document.getElementById('agent_attachFileBtn'),
            attachmentInput: document.getElementById('agent_attachmentInput'),
            attachmentPreviewContainer: document.getElementById('agent_attachmentPreview'),
        };
        this.attachments = [];
        this.store.subscribe(this.render.bind(this), ['isAiThinking']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.sendBtn.addEventListener('click', () => this.sendMessage());
        this.dom.input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 添加这个监听器来实时更新按钮状态
        this.dom.input.addEventListener('input', () => {
            this.updateSendButtonState();
        });
        
        // [新增] 监听选区变化并更新 store
        this.dom.input.addEventListener('mouseup', () => this.updateSelection());
        this.dom.input.addEventListener('keyup', () => this.updateSelection());

        // [新增] 附件事件监听
        this.dom.attachFileBtn.addEventListener('click', () => this.dom.attachmentInput.click());
        this.dom.attachmentInput.addEventListener('change', e => this.handleAttachmentChange(e));
        this.dom.attachmentPreviewContainer.addEventListener('click', e => this.handleRemoveAttachment(e));
    }

    // [新增] 更新编辑器选区状态到 store
    updateSelection() {
        const start = this.dom.input.selectionStart;
        const end = this.dom.input.selectionEnd;
        const text = this.dom.input.value.substring(start, end);
        const hasSelection = start !== end && text.trim().length > 0;

        this.store.setState({
            editorSelection: {
                start,
                end,
                text: hasSelection ? text.trim() : '',
                hasSelection,
                timestamp: Date.now()
            }
        });
        
        if(hasSelection) {
            console.log(`✅ [Agent ChatInput] Selection saved to store.`);
        }
    }
    

    updateSendButtonState() {
        const state = this.store.getState();
        const isThinking = state.isAiThinking;
        const hasContent = this.dom.input.value.trim() !== '' || this.attachments.length > 0;
        this.dom.sendBtn.disabled = isThinking || !hasContent;
    }

    sendMessage() {
        const content = this.dom.input.value.trim();
        if ((!content && this.attachments.length === 0) || this.store.getState().isAiThinking) return;
        
        // 注意：传递附件数组的副本，以防后续操作影响
        this.store.sendMessage(content, [...this.attachments]);
        
        this.dom.input.value = '';
        this.attachments = [];
        this.renderAttachments(); // [新增] 清空附件预览
        this.dom.input.focus();
    }
    
    // [新增] 处理文件选择
    handleAttachmentChange(e) {
        this.attachments = []; // 每次选择都重置
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                this.attachments.push({ name: file.name, data: event.target.result });
                this.renderAttachments();
            };
            reader.readAsDataURL(file);
        });
        
        e.target.value = ''; // 允许再次选择相同文件
    }

    // [新增] 处理移除附件
    handleRemoveAttachment(e) {
        const removeBtn = e.target.closest('.remove-attachment-btn');
        if (!removeBtn) return;
        const index = parseInt(removeBtn.dataset.index, 10);
        this.attachments.splice(index, 1);
        this.renderAttachments();
    }

    // [新增] 渲染附件预览
    renderAttachments() {
        this.dom.attachmentPreviewContainer.innerHTML = '';
        this.attachments.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'attachment-preview-item';
            // 简单判断是否是图片用于预览
            const iconClass = file.data.startsWith('data:image/') ? 'fa-file-image' : 'fa-file';
            item.innerHTML = `<span><i class="fas ${iconClass}"></i> ${escapeHTML(file.name)}</span><button class="remove-attachment-btn" data-index="${index}" title="移除">×</button>`;
            this.dom.attachmentPreviewContainer.appendChild(item);
        });
    }

    render(state) {
        this.updateSendButtonState();
        this.dom.input.disabled = state.isAiThinking;
        this.dom.sendBtn.innerHTML = state.isAiThinking 
            ? '<i class="fas fa-spinner fa-spin"></i>'
            : '<i class="fas fa-paper-plane"></i>';
    }
}
