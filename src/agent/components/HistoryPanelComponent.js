// src/agent/components/HistoryPanelComponent.js

// [MODIFIED] Import the new centralized renderer
import { RichContentRenderer } from '../../common/RichContentRenderer.js';
import { escapeHTML } from '../../common/utils.js';

// [新增] 一个简单的节流函数
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

export class HistoryPanelComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            content: document.getElementById('agent_historyContent'),
            chatInputArea: document.getElementById('agent_chatInputArea'),
            // [新增] 对话导航按钮
            chatNavUp: document.getElementById('agent_chatNavUp'),
            chatNavDown: document.getElementById('agent_chatNavDown'),
        };
        // [新增] 组件内部状态，用于导航
        this.turnElements = [];
        this.currentTurnIndex = -1;
        
        // [修改] 用于存储流式消息的完整状态
        this.streamingMessages = new Map(); 
        
        // [修改] 创建节流版的渲染函数
        this.throttledRenderStream = throttle(this.renderStreamingMessage, 150); // 每150ms最多渲染一次
        
        this.store.subscribe(this.render.bind(this), ['history', 'currentTopicId', 'isAiThinking']);
        
        // [新增] 绑定流式数据块的处理函数，确保 this 指向正确
        this.handleStreamChunk = this.handleStreamChunk.bind(this);
        
        this.setupEventListeners();
    }

    // [新增] 设置事件监听器
    setupEventListeners() {
        // [新增] 监听鼠标释放事件以捕获选区
        this.dom.content.addEventListener('mouseup', this.handleSelection.bind(this));

        this.dom.content.addEventListener('click', e => this.handleActionClick(e));
        this.dom.chatNavUp.addEventListener('click', () => this.navigateTurns(-1));
        this.dom.chatNavDown.addEventListener('click', () => this.navigateTurns(1));

        // [新增] 订阅 store 的流式事件
        this.store.streamEmitter.on('chunk', this.handleStreamChunk);
    }

    // [新增] 组件销毁时取消订阅，防止内存泄漏
    destroy() {
        this.store.streamEmitter.off('chunk', this.handleStreamChunk);
    }

    // [新增] 直接处理流式数据块，高效更新DOM
    handleStreamChunk({ messageId, type, text }) {
        if (!this.streamingMessages.has(messageId)) {
            // 这是这个流的第一块数据
            this.streamingMessages.set(messageId, { content: '', reasoning: '' });
        }
    
        const messageState = this.streamingMessages.get(messageId);
        
        if (type === 'content') {
            messageState.content += text;
        } else if (type === 'thinking') {
            messageState.reasoning += text;
        }
    
        // 触发节流的渲染函数
        this.throttledRenderStream(messageId);
    }

    
    // [新增] 专门用于渲染流式消息的函数
    async renderStreamingMessage(messageId) {
        const messageContainer = this.dom.content.querySelector(`[data-message-id="${messageId}"]`);
        const messageState = this.streamingMessages.get(messageId);
        if (!messageContainer || !messageState) return;

        // 获取内容容器
        const contentContainer = messageContainer.querySelector('.history-item-content');
        if (!contentContainer) return;
        
        const isScrolledToBottom = this.dom.content.scrollHeight - this.dom.content.clientHeight <= this.dom.content.scrollTop + 10;

        // 使用 RichContentRenderer 渲染当前累积的内容
        await RichContentRenderer.render(contentContainer, messageState.content, {});
        
        // 添加一个视觉提示，表明内容仍在加载
        if (!contentContainer.querySelector('.streaming-cursor')) {
            const cursor = document.createElement('span');
            cursor.className = 'streaming-cursor';
            contentContainer.appendChild(cursor);
        }

        if (isScrolledToBottom) {
            this.dom.content.scrollTop = this.dom.content.scrollHeight;
        }
    }

    // [新增] 处理消息操作按钮点击
    handleActionClick(e) {
        if (this.store.getState().isAiThinking) {
            alert("AI 正在思考中，请稍后再试。");
            return;
        }

        const actionBtn = e.target.closest('.history-action-btn');
        if (!actionBtn) return;
        
        const messageItem = actionBtn.closest('.history-item');
        const messageId = messageItem.dataset.messageId;

        if (actionBtn.classList.contains('delete-btn')) {
            if (confirm("确定要删除这组对话吗？")) {
                this.store.deleteMessagePair(messageId);
            }
        } else if (actionBtn.classList.contains('edit-btn')) {
            const currentContent = this.store.getState().history.find(h => h.id === messageId)?.content || '';
            const newContent = prompt("编辑你的消息:", currentContent);
            if (newContent && newContent.trim() !== currentContent) {
                if (confirm("编辑将删除此后的对话并重新生成回应，是否继续？")) {
                    this.store.editUserMessage(messageId, newContent.trim());
                }
            }
        } else if (actionBtn.classList.contains('regenerate-btn')) {
            if (confirm("确定要重新生成这条回应吗？")) {
                this.store.regenerateAssistantResponse(messageId);
            }
        }
    }

    async render(state, oldState = {}) {
        // [修复] 在每次渲染开始时，无条件清空容器。
        // 这可以防止在状态快速变化时，旧的提示信息（如“请选择主题”）残留下来。
        this.dom.content.innerHTML = '';

        if (!state.currentTopicId) {
            this.dom.content.innerHTML = `<div class="no-history"><p>请选择或创建一个主题来开始聊天</p></div>`;
            this.dom.chatInputArea.style.display = 'none';
            return;
        }

        this.dom.chatInputArea.style.display = 'flex';
        const currentHistory = state.history.filter(h => h.topicId === state.currentTopicId)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (currentHistory.length === 0) {
            this.dom.content.innerHTML = `<div class="no-history"><p>这个主题还没有对话记录。</p></div>`;
            this.updateNavState(); // 更新导航按钮状态
            return;
        }
        
        const isScrolledToBottom = this.dom.content.scrollHeight - this.dom.content.clientHeight <= this.dom.content.scrollTop + 5;
        
        await this.updateMessageList(currentHistory);

        this.updateNavState(); // 更新导航按钮状态

        if (state.history.length > (oldState.history?.length || 0) || isScrolledToBottom) {
             // 如果是新消息，延迟滚动以等待可能的渲染完成
            setTimeout(() => this.dom.content.scrollTop = this.dom.content.scrollHeight, 50);
        } else if (state.currentTopicId !== oldState.currentTopicId) {
            this.dom.content.scrollTop = state.topicScrollPositions[state.currentTopicId] || 0;
            this.currentTurnIndex = -1; // 重置导航索引
        }
    }
    
    async updateMessageList(messages) {
        // 由于我们在 render 开始时清空了父容器，这里的逻辑可以被简化，
        // 不再需要检查 DOM 中是否已存在 message item。
        for (const message of messages) {
            const item = document.createElement('div');
            item.dataset.messageId = message.id;
            await this.renderMessageItem(item, message); // 渲染内容
            this.dom.content.appendChild(item); // 添加到 DOM
        }
    }

    async renderMessageItem(item, message) {
        item.className = `history-item role-${message.role}`;
        item.innerHTML = `
            <div class="history-item-header">
                <span class="role ${message.role}">${message.role === 'user' ? '用户' : 'AI助手'}</span>
                <span>${new Date(message.timestamp).toLocaleString()}</span>
            </div>
            <div class="history-item-content"></div>
            <div class="history-item-actions">
                <button class="history-action-btn regenerate-btn" title="重新生成" style="display: ${message.role === 'assistant' ? 'inline-flex' : 'none'};"><i class="fas fa-redo"></i></button>
                <button class="history-action-btn edit-btn" title="编辑并重新生成" style="display: ${message.role === 'user' ? 'inline-flex' : 'none'};"><i class="fas fa-edit"></i></button>
                <button class="history-action-btn delete-btn" title="删除"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        item.dataset.lastStatus = message.status;
        const contentContainer = item.querySelector('.history-item-content');
        
        // [重构] 渲染逻辑分离
        if (message.status === 'streaming') {
            contentContainer.innerHTML = '<p class="streaming-initial-loader"><i class="fas fa-spinner fa-pulse"></i></p>';
        } else {
            // 如果是已完成的消息，在这里一次性渲染
            // 同时清理流式状态
            if (this.streamingMessages.has(message.id)) {
                this.streamingMessages.delete(message.id);
            }
            let markdownText = message.content || '';
            if (message.role === 'assistant' && message.reasoning) {
                const thinkingBlock = `<details class="thinking-block"><summary>AI 思考过程</summary><pre><code>${escapeHTML(message.reasoning)}</code></pre></details>`;
                markdownText = thinkingBlock + markdownText;
            }
            await RichContentRenderer.render(contentContainer, markdownText, {});
        }
    }

    async updateMessageContent(container, message) {
        // [修改] 流式消息的渲染逻辑
        if (message.status === 'streaming') {
            // 初始渲染时，只创建一个空容器。内容将由 handleStreamChunk 动态填充。
            // 使用 `container.hasChildNodes()` 防止重复创建
            if (!container.hasChildNodes()) {
                 container.innerHTML = `
                    <div class="streaming-content-container">
                        <p><i class="fas fa-spinner fa-pulse"></i></p>
                        <div class="streaming-content-body"></div>
                    </div>`;
            }
        } else {
            // 完成/错误的消息：使用富文本渲染器
            let markdownText = message.content || '';
            if (message.role === 'assistant' && message.reasoning) {
                const thinkingBlock = `<details class="thinking-block"><summary>AI 思考过程</summary><pre><code>${escapeHTML(message.reasoning)}</code></pre></details>`;
                markdownText = thinkingBlock + markdownText;
            }
        
            // [MODIFIED] Use the new RichContentRenderer
            // The third argument (context) is an empty object because agent messages don't have cloze states.
            await RichContentRenderer.render(container, markdownText, {});
        }
    }

    // 辅助方法：生成内容哈希用于比较
    getContentHash(message) {
        const contentString = `${message.content || ''}${message.reasoning || ''}`;
        return contentString.length + '_' + (contentString.slice(0, 50) + contentString.slice(-50));
    }

    // [新增] 更新导航按钮的可用状态
    updateNavState() {
        this.turnElements = Array.from(this.dom.content.querySelectorAll('.history-item.role-user'));
        const hasTurns = this.turnElements.length > 0;
        this.dom.chatNavUp.disabled = !hasTurns;
        this.dom.chatNavDown.disabled = !hasTurns;
        if (!hasTurns) {
            this.currentTurnIndex = -1;
        }
    }

    // [新增] 实现上下回合导航
    navigateTurns(direction) {
        if (this.turnElements.length === 0) return;

        // 移除旧的高亮
        this.dom.content.querySelectorAll('.highlighted').forEach(el => el.classList.remove('highlighted'));

        // 计算新索引
        if (this.currentTurnIndex === -1) {
             this.currentTurnIndex = (direction === 1) ? 0 : this.turnElements.length - 1;
        } else {
             this.currentTurnIndex = (this.currentTurnIndex + direction + this.turnElements.length) % this.turnElements.length;
        }

        const userTurnEl = this.turnElements[this.currentTurnIndex];
        if (userTurnEl) {
            userTurnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // 高亮当前回合（用户+AI）
            userTurnEl.classList.add('highlighted');
            const nextEl = userTurnEl.nextElementSibling;
            if (nextEl && nextEl.classList.contains('role-assistant')) {
                nextEl.classList.add('highlighted');
            }
        }
    }

    // [新增] 处理文本选择的函数
    handleSelection(e) {
        // 确保不是在点击交互元素时触发
        if (e.target.closest('.history-action-btn, a, button, summary')) {
            return;
        }

        const selectedText = window.getSelection().toString();
        this.store.setPreviewSelection(selectedText);

        if (selectedText.trim()) {
            console.log(`✅ [Agent HistoryPanel] Selection saved to store.`);
        }
    }

    destroy() {
        this.store.streamEmitter.off('chunk', this.handleStreamChunk);
    }
}
