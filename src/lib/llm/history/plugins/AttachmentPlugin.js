/**
 * #llm/history/plugins/AttachmentPlugin.js
 * @file Plugin for file attachment support
 */

export class AttachmentPlugin {
    constructor(options = {}) {
        this.options = {
            maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
            allowedTypes: options.allowedTypes || ['image/*', 'application/pdf', 'text/*'],
            // --- DELETED: uploadUrl is no longer needed here.
            ...options
        };
    }
    
    /**
     * Install plugin
     * @param {LLMHistoryUI} historyUI
     */
    install(historyUI) {
        this.historyUI = historyUI;
        // +++ ADDED: Get the file storage service from the main component's options.
        this.fileStorage = historyUI.options.fileStorage;

        historyUI.on('pairAdded', ({ pair }) => {
            this._addAttachmentButton(pair);
        });
    }
    
    /**
     * Add attachment button to user toolbar
     * @private
     */
    _addAttachmentButton(pair) {
        // Use BEM modifier for the user toolbar
        const toolbar = pair.userElement?.querySelector('.llm-historyui__message-toolbar--user');
        if (!toolbar) return;
        
        const attachBtn = document.createElement('button');
        // Use BEM element
        attachBtn.className = 'llm-historyui__toolbar-btn';
        attachBtn.dataset.action = 'attach';
        attachBtn.title = '添加附件';
        attachBtn.innerHTML = '<i class="fas fa-paperclip"></i>';
        
        attachBtn.addEventListener('click', () => {
            this._showAttachmentDialog(pair);
        });
        
        // Insert before delete button
        const deleteBtn = toolbar.querySelector('[data-action="delete"]');
        toolbar.insertBefore(attachBtn, deleteBtn);
    }
    
    /**
     * Show attachment dialog
     * @private
     */
    _showAttachmentDialog(pair) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = this.options.allowedTypes.join(',');
        
        input.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            
            for (const file of files) {
                if (file.size > this.options.maxFileSize) {
                    alert(`文件 "${file.name}" 超过大小限制 ${this._formatSize(this.options.maxFileSize)}`);
                    continue;
                }
                
                await this._uploadFile(file, pair);
            }
        });
        
        input.click();
    }
    
    /**
     * Upload file
     * @private
     */
    async _uploadFile(file, pair) {
        // +++ ADDED: Guard clause to check if the upload service is configured.
        if (!this.fileStorage) {
            console.error('AttachmentPlugin: `fileStorage` service is not provided in historyUI options.');
            alert('File upload functionality is not configured.');
            return;
        }

        try {
            // --- DELETED: FormData and fetch logic.
            // const formData = new FormData();
            // formData.append('file', file);
            // const response = await fetch(this.options.uploadUrl, { ... });
            
            // +++ MODIFIED: Use the injected file storage service.
            const result = await this.fileStorage.upload(file);
            
            // Add to user message using the result from the service
            pair.userMessage.addAttachment({
                type: this._getFileType(file),
                url: result.url,
                name: result.name,
                size: result.size
            });
            
            // Re-render user message to show attachment
            this._rerenderUserMessage(pair);
            
        } catch (error) {
            console.error('Failed to upload file:', error);
            alert(`上传失败: ${error.message}`);
        }
    }
    
    /**
     * Get file type
     * @private
     */
    _getFileType(file) {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type === 'application/pdf') return 'pdf';
        return 'file';
    }
    
    /**
     * Re-render user message to show attachments
     * @private
     */
    _rerenderUserMessage(pair) {
        const oldElement = pair.userElement;
        const newElement = this.historyUI.messageRenderer.renderUserMessage(pair);
        
        if (oldElement && oldElement.parentNode) {
            oldElement.parentNode.replaceChild(newElement, oldElement);
            pair.userElement = newElement;
        }
    }
    
    /**
     * Format file size
     * @private
     */
    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    /**
     * Destroy plugin
     */
    destroy() {
        // Cleanup if needed
    }
}
