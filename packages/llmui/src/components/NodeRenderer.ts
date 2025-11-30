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

        if (node.type === 'agent') {
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
        
        el.innerHTML = `
            <div class="llm-ui-node__header">
                <div class="llm-ui-node__icon">${node.icon || '🤖'}</div>
                <div class="llm-ui-node__title">${node.name}</div>
                <div class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</div>
                
                <div class="llm-ui-actions">
                    <button class="llm-ui-btn-action llm-ui-action-edit" title="Edit Output">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                </div>
            </div>
            
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
        `;

        mounts.output = el.querySelector(`#mount-${node.id}`);
    }

    private static renderTool(el: HTMLElement, node: ExecutionNode) {
        el.innerHTML = `
            <div class="llm-ui-node__header">
                <span class="llm-ui-node__icon">🔧</span>
                <span class="llm-ui-node__title">${node.name}</span>
                <span class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</span>
            </div>
            <div class="llm-ui-node__args"><code>${JSON.stringify(node.data.toolCall?.args || {})}</code></div>
            <div class="llm-ui-node__result"></div>
        `;
    }

    private static renderThought(el: HTMLElement, node: ExecutionNode) {
        el.innerHTML = `
            <div class="llm-ui-thought-bubble">
                <span class="llm-ui-node__icon">🤔</span>
                <span class="llm-ui-thought__content"></span>
            </div>
        `;
    }
}