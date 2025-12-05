// @file llm-ui/components/HistoryView.ts
import { OrchestratorEvent, SessionGroup, ExecutionNode } from '../types';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';

// ✨ [新增] 定义节点动作接口
export interface NodeActionCallback {
    (action: 'retry' | 'delete', nodeId: string): void;
}

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;
    
    private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    private onNodeAction?: NodeActionCallback;

    constructor(
        container: HTMLElement, 
        onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
        onNodeAction?: NodeActionCallback
    ) {
        this.container = container;
        this.onContentChange = onContentChange;
        this.onNodeAction = onNodeAction;
    }

    clear() {
        this.container.innerHTML = '';
        this.nodeMap.clear();
        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();
    }

    renderFull(sessions: SessionGroup[]) {
        this.clear();
        if (sessions.length === 0) {
            this.renderWelcome();
            return;
        }
        sessions.forEach(session => {
            this.appendSessionGroup(session);
            if (session.executionRoot) {
                this.renderExecutionTree(session.executionRoot);
            }
        });
        this.scrollToBottom();
    }

    renderWelcome() {
        this.container.innerHTML = `
            <div class="llm-ui-welcome">
                <div class="llm-ui-welcome__icon">👋</div>
                <h2>Ready to chat</h2>
            </div>
        `;
    }

    renderError(error: Error) {
        const div = document.createElement('div');
        div.className = 'llm-ui-banner llm-ui-banner--error';
        div.innerText = `Error: ${error.message}`;
        this.container.appendChild(div);
    }

    processEvent(event: OrchestratorEvent) {
        if (this.container.querySelector('.llm-ui-welcome')) this.container.innerHTML = '';

        switch (event.type) {
            case 'session_start':
                this.appendSessionGroup(event.payload);
                break;
            case 'node_start':
                this.appendNode(event.payload.parentId, event.payload.node);
                break;
            case 'node_update':
                // [修复] 增加空值检查，因为 node_update 可能仅包含 metaInfo 而没有文本 chunk
                if (event.payload.chunk !== undefined && event.payload.field !== undefined) {
                    this.updateNodeContent(event.payload.nodeId, event.payload.chunk, event.payload.field);
                }
                break;
            case 'node_status':
                this.updateNodeStatus(event.payload.nodeId, event.payload.status, event.payload.result);
                break;
            case 'finished':
                this.editorMap.forEach(editor => editor.finishStream());
                break;
        }
        
        // 只有产生内容更新时才滚动，避免元数据更新导致频繁跳动
        if (event.type === 'node_update' && event.payload.chunk) {
             this.scrollToBottom();
        } else if (event.type !== 'node_update') {
             this.scrollToBottom();
        }
    }

    private appendSessionGroup(group: SessionGroup) {
        const wrapper = document.createElement('div');
        wrapper.className = `llm-ui-session llm-ui-session--${group.role}`;
        wrapper.dataset.sessionId = group.id;

        if (group.role === 'user') {
            // [修改] 增加 Copy 和 Collapse 按钮
            wrapper.innerHTML = `
                <div class="llm-ui-avatar">👤</div>
                <div class="llm-ui-bubble--user">
                    <div class="llm-ui-bubble__header">
                        <span class="llm-ui-bubble__title">You</span>
                        <div class="llm-ui-bubble__toolbar">
                             <button class="llm-ui-btn-bubble-tool" data-action="edit" title="Edit">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                             </button>
                             <button class="llm-ui-btn-bubble-tool" data-action="copy" title="Copy">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                             </button>
                             <button class="llm-ui-btn-bubble-tool" data-action="collapse" title="Collapse/Expand">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                             </button>
                        </div>
                    </div>
                    <div class="llm-ui-mount-point" id="user-mount-${group.id}"></div>
                </div>
            `;
            this.container.appendChild(wrapper);
            
            const mountPoint = wrapper.querySelector(`#user-mount-${group.id}`) as HTMLElement;
            const controller = new MDxController(mountPoint, group.content || '', {
                readOnly: true,
                onChange: (text) => this.onContentChange?.(group.id, text, 'user')
            });
            this.editorMap.set(group.id, controller);

            // --- 绑定事件 ---
            const bubbleEl = wrapper.querySelector('.llm-ui-bubble--user') as HTMLElement;
            const editBtn = wrapper.querySelector('[data-action="edit"]');
            const copyBtn = wrapper.querySelector('[data-action="copy"]');
            const collapseBtn = wrapper.querySelector('[data-action="collapse"]');

            // 1. Edit
            editBtn?.addEventListener('click', () => {
                controller.toggleEdit();
                editBtn.classList.toggle('active');
            });

            // 2. Copy
            copyBtn?.addEventListener('click', async () => {
                const text = controller.content; 
                try {
                    await navigator.clipboard.writeText(text);
                    const originalHtml = copyBtn.innerHTML;
                    copyBtn.innerHTML = '✓'; 
                    setTimeout(() => copyBtn.innerHTML = originalHtml, 1500);
                } catch (err) {
                    console.error('Copy failed', err);
                }
            });

            // 3. Collapse
            // 修正初始图标为 Up Arrow (因为默认是展开的)
            if (collapseBtn) {
                 const svg = collapseBtn.querySelector('svg');
                 if (svg) svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
            }

            collapseBtn?.addEventListener('click', () => {
                bubbleEl.classList.toggle('is-collapsed');
                const svg = collapseBtn.querySelector('svg');
                if (!svg) return;

                if (bubbleEl.classList.contains('is-collapsed')) {
                    // 向下箭头 (点击展开) - User Bubble 默认箭头是向下的 (open state)
                    // 所以 collapse 后应该是向上? 或者反过来。保持和 Agent 一致：
                    // 折叠后 -> 箭头变为 "Show More" 意图
                    // 这里我们定义: 
                    // 初始状态 (Open): 箭头 <polyline points="6 9 12 15 18 9"></polyline> (Down arrow, meaning collapse content below?)
                    // 其实 Agent 的实现是: 默认显示 "Down V", 点击后变成 "Up ^"? 
                    // 让我们统一逻辑：
                    // Expanded State: 显示 "Chevron Up" (收起) 或 "Chevron Down" (展开)? 
                    // 通常: Chevron Up = 收起; Chevron Down = 展开.
                    
                    // 修正逻辑以符合直觉：
                    // 当前是折叠态 -> 显示向下箭头 (表示点击展开)
                    // 当前是展开态 -> 显示向上箭头 (表示点击收起)
                    
                    // 这里代码里初始SVG是 Down (6 9 12 15 18 9)。 
                    // 如果初始是展开的，应该显示 UP icon。
                    // 让我们调整一下初始图标。
                    // 假设初始SVG改为 UP: <polyline points="18 15 12 9 6 15"></polyline>
                    
                    // is-collapsed = true (Hidden) -> Show Down Arrow
                    svg!.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>'; 
                } else {
                    // is-collapsed = false (Visible) -> Show Up Arrow
                    svg!.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
                }
            });

        } else {
            wrapper.innerHTML = `
                <div class="llm-ui-avatar">🤖</div>
                <div class="llm-ui-execution-root" id="container-${group.id}"></div>
            `;
            this.container.appendChild(wrapper);
        }
    }

    private appendNode(parentId: string | undefined, node: ExecutionNode) {
        let parentEl: HTMLElement | null = null;
        if (parentId) {
            parentEl = this.nodeMap.get(parentId)?.querySelector('.llm-ui-node__children') || null;
        }
        if (!parentEl) {
            const roots = this.container.querySelectorAll('.llm-ui-execution-root');
            if (roots.length > 0) parentEl = roots[roots.length - 1] as HTMLElement;
        }

        if (parentEl) {
            const { element, mountPoints } = NodeRenderer.create(node);
            this.nodeMap.set(node.id, element);
            parentEl.appendChild(element);

            // --- 绑定头部工具栏事件 ---
            const editBtn = element.querySelector('[data-action="edit"]');
            const copyBtn = element.querySelector('[data-action="copy"]');
            const collapseBtn = element.querySelector('[data-action="collapse"]');
            
            // ✨ [新增] 绑定 Retry 和 Delete
            const retryBtn = element.querySelector('[data-action="retry"]');
            const deleteBtn = element.querySelector('[data-action="delete"]');

            retryBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onNodeAction?.('retry', node.id);
            });

            deleteBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                // 简单的 UI 确认 (可选，也可以在业务层做)
                if (confirm('Delete this message?')) {
                    this.onNodeAction?.('delete', node.id);
                }
            });

            // 修正初始图标为 Up Arrow (因为默认是展开的)
            if (collapseBtn) {
                const svg = collapseBtn.querySelector('svg');
                if (svg) svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
            }

            collapseBtn?.addEventListener('click', () => {
                element.classList.toggle('is-collapsed');
                const svg = collapseBtn.querySelector('svg');
                if (!svg) return;

                if (element.classList.contains('is-collapsed')) {
                    // 折叠了 -> 显示向下箭头 (展开)
                    svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>'; 
                } else {
                    // 展开了 -> 显示向上箭头 (收起)
                    svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
                }
            });

            if (mountPoints.output) {
                const controller = new MDxController(mountPoints.output, node.data.output || '', {
                    readOnly: true,
                    onChange: (text) => this.onContentChange?.(node.id, text, 'node')
                });
                this.editorMap.set(node.id, controller);

                // Edit 逻辑
                editBtn?.addEventListener('click', () => {
                    controller.toggleEdit();
                    editBtn.classList.toggle('active');
                });

                // Copy 逻辑
                copyBtn?.addEventListener('click', async () => {
                    const text = controller.content; // Access content via getter
                    try {
                        await navigator.clipboard.writeText(text);
                        // 临时反馈动画
                        const originalHtml = copyBtn.innerHTML;
                        copyBtn.innerHTML = '✓'; 
                        setTimeout(() => copyBtn.innerHTML = originalHtml, 1500);
                    } catch (err) {
                        console.error('Copy failed', err);
                    }
                });
            } else {
                // 如果没有输出挂载点 (例如 Thought only node), 禁用 Edit/Copy
                if (editBtn) (editBtn as HTMLButtonElement).style.display = 'none';
                if (copyBtn) (copyBtn as HTMLButtonElement).style.display = 'none';
            }
        }
    }

    private updateNodeContent(nodeId: string, chunk: string, field: 'thought' | 'output') {
        const el = this.nodeMap.get(nodeId);
        if (!el) return;

        if (field === 'thought') {
            const container = el.querySelector('.llm-ui-thought') as HTMLElement;
            const contentEl = el.querySelector('.llm-ui-thought__content') as HTMLElement;
            
            if (container.style.display === 'none') container.style.display = 'block';
            contentEl.innerHTML += this.escapeHtml(chunk).replace(/\n/g, '<br>');
            container.scrollTop = container.scrollHeight;
        } else if (field === 'output') {
            const editor = this.editorMap.get(nodeId);
            if (editor) {
                editor.appendStream(chunk);
            }
        }
    }

    private updateNodeStatus(nodeId: string, status: string, result?: any) {
        const el = this.nodeMap.get(nodeId);
        if (el) {
            el.dataset.status = status;
            // 更新 class 实现样式变化
            el.classList.remove('llm-ui-node--running', 'llm-ui-node--success', 'llm-ui-node--failed');
            el.classList.add(`llm-ui-node--${status}`);
            
            const statusText = el.querySelector('.llm-ui-node__status');
            if (statusText) {
                statusText.textContent = status;
                statusText.className = `llm-ui-node__status llm-ui-node__status--${status}`;
            }

            // 工具结果显示
            if (result && el.classList.contains('llm-ui-node--tool')) {
                 const resEl = el.querySelector('.llm-ui-node__result') as HTMLElement;
                 if (resEl) {
                     resEl.style.display = 'block';
                     resEl.textContent = typeof result === 'string' ? result : JSON.stringify(result);
                 }
            }
        }
        
        const editor = this.editorMap.get(nodeId);
        if (editor && (status === 'success' || status === 'failed')) {
            editor.finishStream();
        }
    }

    private renderExecutionTree(node: ExecutionNode) {
        this.appendNode(node.parentId, node);
        node.children?.forEach(c => this.renderExecutionTree(c));
    }
    
    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }
    
    private escapeHtml(str: string) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
