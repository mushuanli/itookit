// @file llm-ui/components/HistoryView.ts
import { OrchestratorEvent, SessionGroup, ExecutionNode } from '../types';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;
    private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;

    constructor(container: HTMLElement, onContentChange?: (id: string, content: string, type: 'user' | 'node') => void) {
        this.container = container;
        this.onContentChange = onContentChange;
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
                this.updateNodeContent(event.payload.nodeId, event.payload.chunk, event.payload.field);
                break;
            case 'node_status':
                this.updateNodeStatus(event.payload.nodeId, event.payload.status, event.payload.result);
                break;
            case 'finished':
                this.editorMap.forEach(editor => editor.finishStream());
                break;
        }
        
        if (event.type !== 'node_update') this.scrollToBottom();
    }

    private appendSessionGroup(group: SessionGroup) {
        const wrapper = document.createElement('div');
        wrapper.className = `llm-ui-session llm-ui-session--${group.role}`;
        wrapper.dataset.sessionId = group.id;

        if (group.role === 'user') {
            wrapper.innerHTML = `
                <div class="llm-ui-avatar">👤</div>
                <div class="llm-ui-bubble--user">
                    <div class="llm-ui-actions">
                         <button class="llm-ui-btn-action llm-ui-action-edit">✎</button>
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

            wrapper.querySelector('.llm-ui-action-edit')?.addEventListener('click', () => {
                controller.toggleEdit();
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

            if (mountPoints.output) {
                const controller = new MDxController(mountPoints.output, node.data.output || '', {
                    readOnly: true,
                    onChange: (text) => this.onContentChange?.(node.id, text, 'node')
                });
                this.editorMap.set(node.id, controller);

                element.querySelector('.llm-ui-action-edit')?.addEventListener('click', () => {
                    controller.toggleEdit();
                });
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
            this.scrollToBottom();
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
