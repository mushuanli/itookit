// @file llm-ui/components/NodeRenderer.ts
import { escapeHTML } from '@itookit/common';
import { ExecutionNode } from '../types';

export interface RenderResult {
    element: HTMLElement;
    mountPoints: {
        output?: HTMLElement;
    }
}

export class NodeRenderer {
    static create(node: ExecutionNode): RenderResult {
        const el = document.createElement('div');
        // BEM: llm-ui-node llm-ui-node--[type]
        el.className = `llm-ui-node llm-ui-node--${node.type}`;
        el.dataset.id = node.id;
        el.dataset.status = node.status;

        const mountPoints: { output?: HTMLElement } = {};

        if (node.type === 'agent' || node.type === 'router') { // router 也可以有工具栏
            this.renderAgent(el, node, mountPoints);
        } else if (node.type === 'tool') {
            this.renderTool(el, node);
        } else if (node.type === 'thought') {
            this.renderThought(el, node);
        }

        return { element: el, mountPoints };
    }

    private static renderAgent(el: HTMLElement, node: ExecutionNode, mounts: any) {
        const hasThought = node.data.thought && node.data.thought.length > 0;
        const previewText = node.data.output ? node.data.output.substring(0, 50).replace(/\n/g, ' ') : '';

        // [修改] HTML 结构: 增加 Preview 和 Branch Nav 占位符
        el.innerHTML = `
            <div class="llm-ui-node__header">
                <span class="llm-ui-node__icon">${node.icon || '🤖'}</span>
                
                <span class="llm-ui-node__title">${escapeHTML(node.name || 'Assistant')}</span>
                
                <!-- [新增] 3. 折叠预览文本 -->
                <span class="llm-ui-header-preview">${escapeHTML(previewText)}</span>
                
                <div style="flex:1"></div>

                <!-- [新增] 2. 分支导航 (静态示例，需业务逻辑填充) -->
                <!-- 
                <div class="llm-ui-branch-nav" style="display:none">
                    <button class="llm-ui-branch-btn">&lt;</button>
                    <span>1/1</span>
                    <button class="llm-ui-branch-btn">&gt;</button>
                </div> 
                -->

                <div class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</div>
                
                <div class="llm-ui-node__toolbar">
                    <button class="llm-ui-btn-tool" data-action="retry" title="Regenerate">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                    
                    <button class="llm-ui-btn-tool" data-action="edit" title="Edit Mode">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    
                    <button class="llm-ui-btn-tool" data-action="copy" title="Copy Content">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>

                    <button class="llm-ui-btn-tool" data-action="delete" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--llm-ui-color-error)"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>

                    <button class="llm-ui-btn-tool" data-action="collapse" title="Collapse/Expand">
                        <svg class="icon-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                    </button>
                </div>
            </div>
            
            <div class="llm-ui-node__body">
                <details class="llm-ui-thought" ${hasThought ? 'open' : ''} style="${hasThought ? 'display:block' : 'display:none'}">
                    <summary class="llm-ui-thought__summary">
                        <span>💭 Thinking Process</span>
                    </summary>
                    <div class="llm-ui-thought__content">${escapeHTML(node.data.thought || '')}</div>
                </details>

                <div class="llm-ui-node__output">
                    <div class="llm-ui-mount-point" id="mount-${node.id}"></div>
                </div>

                <div class="llm-ui-node__children"></div>
            </div>
        `;

        mounts.output = el.querySelector(`#mount-${node.id}`);
    }

    private static renderTool(el: HTMLElement, node: ExecutionNode) {
        // Tool 节点通常不需要 Retry 整个 Chat，但可以考虑 Delete
        el.innerHTML = `
            <div class="llm-ui-node__header">
                <span class="llm-ui-node__icon">🔧</span>
                <span class="llm-ui-node__title">${escapeHTML(node.name)}</span>
                
                <!-- 预览 -->
                <span class="llm-ui-header-preview">Tool Call...</span>
                <div style="flex:1"></div>

                <span class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</span>
                <div class="llm-ui-node__toolbar">
                     <button class="llm-ui-btn-tool" data-action="delete" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="llm-ui-node__body">
                <div class="llm-ui-node__args"><code>${escapeHTML(JSON.stringify(node.data.toolCall?.args || {}))}</code></div>
                <div class="llm-ui-node__result"></div>
            </div>
        `;
    }
    
    private static renderThought(el: HTMLElement, node: ExecutionNode) {
        el.innerHTML = `
            <div class="llm-ui-thought-bubble">
                <span class="llm-ui-node__icon">🤔</span>
                <span class="llm-ui-thought__content">Thinking...</span>
            </div>
        `;
    }
}