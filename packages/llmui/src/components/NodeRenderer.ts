// @file llm-ui/components/NodeRenderer.ts
import { escapeHTML } from '@itookit/common';
import { ExecutionNode } from '../core/types';
import { NodeTemplates } from './templates/NodeTemplates';

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

        if (node.type === 'agent' || node.type === 'router') {
            this.renderAgent(el, node, mountPoints);
        } else if (node.type === 'tool') {
            el.innerHTML = NodeTemplates.renderTool(node);
        } else if (node.type === 'thought') {
            el.innerHTML = NodeTemplates.renderThinking(node.data.thought || '', true);
        }

        return { element: el, mountPoints };
    }

    private static renderAgent(el: HTMLElement, node: ExecutionNode, mounts: any) {
        const hasThought = node.data.thought && node.data.thought.length > 0 ? true:false;
        const previewText = node.data.output ? node.data.output.substring(0, 50).replace(/\n/g, ' ') : '';

        el.innerHTML = `
            ${NodeTemplates.renderAgentHeader(node, previewText)}

            <div class="llm-ui-node__body">
                ${NodeTemplates.renderThinking(node.data.thought || '', hasThought)}

                <div class="llm-ui-node__output">
                    <div class="llm-ui-mount-point" id="mount-${node.id}"></div>
                </div>

                <div class="llm-ui-node__children"></div>
            </div>
        `;

        mounts.output = el.querySelector(`#mount-${node.id}`);
    }
}