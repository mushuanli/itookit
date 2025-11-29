// @file llm-ui/components/HistoryView.ts
import { OrchestratorEvent, SessionGroup, ExecutionNode } from '../types';
import { NodeRenderer } from './NodeRenderer';

export class HistoryView {
    // 缓存 DOM 引用以便快速更新 (nodeId -> HTMLElement)
    private nodeMap = new Map<string, HTMLElement>();
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    clear() {
        this.container.innerHTML = '';
        this.nodeMap.clear();
    }

    /**
     * 渲染完整历史 (用于加载存档)
     */
    renderFull(sessions: SessionGroup[]) {
        this.clear();
        if (sessions.length === 0) {
            this.renderWelcome();
            return;
        }
        
        sessions.forEach(session => {
            this.appendSessionGroup(session);
            if (session.executionRoot) {
                // 递归渲染树 (简化版，实际需要遍历树)
                this.renderExecutionTree(session.executionRoot, `container-${session.id}`);
            }
        });
        this.scrollToBottom();
    }

    renderWelcome() {
        this.container.innerHTML = `
            <div class="llm-welcome">
                <div class="welcome-icon">👋</div>
                <h2>How can I help you today?</h2>
                <p>Ask me anything or use @ to call a specific agent.</p>
            </div>
        `;
    }

    renderError(error: Error) {
        const div = document.createElement('div');
        div.className = 'system-error-banner';
        div.innerText = `Error: ${error.message}`;
        this.container.appendChild(div);
    }

    /**
     * 处理实时事件
     */
    processEvent(event: OrchestratorEvent) {
        // 如果有欢迎页，先清除
        if (this.container.querySelector('.llm-welcome')) {
            this.container.innerHTML = '';
        }

        switch (event.type) {
            case 'session_start':
                this.appendSessionGroup(event.payload);
                break;
            
            case 'node_start':
                this.appendNode(event.payload.parentId, event.payload.node);
                break;

            case 'node_update':
                this.updateNodeContent(event.payload.nodeId, event.payload.chunk, event.payload.field);
                break;

            case 'node_status':
                this.updateNodeStatus(event.payload.nodeId, event.payload.status, event.payload.result);
                break;
        }
        
        this.scrollToBottom();
    }

    private appendSessionGroup(group: SessionGroup) {
        const wrapper = document.createElement('div');
        wrapper.className = `session-wrapper role-${group.role}`;
        wrapper.dataset.sessionId = group.id;

        if (group.role === 'user') {
            wrapper.innerHTML = `
                <div class="user-avatar">👤</div>
                <div class="user-bubble">${this.escapeHtml(group.content || '')}</div>
            `;
        } else {
            // AI 响应容器
            wrapper.innerHTML = `
                <div class="ai-avatar">🤖</div>
                <div class="execution-root" id="container-${group.id}"></div>
            `;
        }
        this.container.appendChild(wrapper);
    }

    private appendNode(parentId: string | undefined, node: ExecutionNode) {
        // 确定挂载点
        let parentEl: HTMLElement | null = null;

        if (parentId) {
            // 尝试找父节点
            const parentNodeEl = this.nodeMap.get(parentId);
            if (parentNodeEl) {
                parentEl = parentNodeEl.querySelector('.node-children');
            }
        }

        // 如果没有指定父节点或找不到父节点，挂载到最后一个 session container
        if (!parentEl) {
            const sessions = this.container.querySelectorAll('.execution-root');
            if (sessions.length > 0) {
                parentEl = sessions[sessions.length - 1] as HTMLElement;
            }
        }

        if (parentEl) {
            const nodeEl = NodeRenderer.create(node);
            this.nodeMap.set(node.id, nodeEl);
            parentEl.appendChild(nodeEl);
            
            // 动画效果
            requestAnimationFrame(() => nodeEl.classList.add('visible'));
        }
    }

    private updateNodeContent(nodeId: string, chunk: string, field: 'thought' | 'output') {
        const el = this.nodeMap.get(nodeId);
        if (!el) return;

        const selector = field === 'thought' ? '.node-thought-content' : '.node-output-content';
        const target = el.querySelector(selector);
        if (target) {
            // 如果是 thought，确保容器可见
            if (field === 'thought') {
                el.querySelector('.agent-thought-container')?.setAttribute('style', 'display:block');
            }
            // 简单的文本追加，实际项目应接入 Markdown 流式解析
            target.innerHTML += this.escapeHtml(chunk).replace(/\n/g, '<br>');
        }
    }

    private updateNodeStatus(nodeId: string, status: string, result?: any) {
        const el = this.nodeMap.get(nodeId);
        if (!el) return;

        el.dataset.status = status;
        const statusText = el.querySelector('.agent-status-text') || el.querySelector('.tool-status');
        if (statusText) statusText.textContent = status;

        if (status === 'success') {
            el.classList.add('finished');
        } else if (status === 'failed') {
            el.classList.add('error');
        }

        // 如果是工具，显示结果
        if (result && el.classList.contains('node-type-tool')) {
            const resEl = el.querySelector('.tool-result') as HTMLElement;
            if (resEl) {
                resEl.style.display = 'block';
                resEl.textContent = typeof result === 'string' ? result : JSON.stringify(result);
            }
        }
    }

    // 辅助: 递归渲染树 (用于加载历史)
    private renderExecutionTree(node: ExecutionNode, containerId: string) {
        // ... (递归逻辑类似于 appendNode，此处略以节省篇幅) ...
    }

    scrollToBottom() {
        const lastEl = this.container.lastElementChild;
        if (lastEl) {
            lastEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
