// @file: llm-ui/components/history/NodeRenderer.ts

import { escapeHTML } from '@itookit/common';
import { ExecutionNode } from '@itookit/llm-conversation';
import { NodeTemplates } from '../templates/NodeTemplates';
import { IconResolver } from '../../utils/iconResolver';

export interface RenderResult {
    element: HTMLElement;
    mountPoints: {
        output?: HTMLElement;
    };
}

export class NodeRenderer {
    static create(node: ExecutionNode): RenderResult {
        const el = document.createElement('div');

        // ✅ 使用共享 IconResolver
        const icon = IconResolver.getIcon(node);
        const layoutClass = IconResolver.getLayoutClass(node);

        el.className = `llm-ui-node llm-ui-node--${node.executorType} ${layoutClass}`;
        el.dataset.id = node.id;
        el.dataset.status = node.status;

        const mountPoints: { output?: HTMLElement } = {};

        if (node.executorType === 'agent' || node.executorType === 'composite') {
            this.renderAgent(el, node, mountPoints, icon);
        } else if (node.executorType === 'tool') {
            el.innerHTML = NodeTemplates.renderTool(node, icon);
        } else {
            this.renderAgent(el, node, mountPoints, icon);
        }

        return { element: el, mountPoints };
    }

    private static renderAgent(
        el: HTMLElement,
        node: ExecutionNode,
        mounts: any,
        icon: string
    ): void {
        const hasThought = !!(node.data.thought && node.data.thought.length > 0);
        const previewText = node.data.output
            ? node.data.output.substring(0, 50).replace(/\n/g, ' ')
            : '';

        const errorHtml = node.status === 'failed' && node.data.error
            ? `<div class="llm-ui-node__error-embed">⚠️ ${escapeHTML(node.data.error)}</div>`
            : '';

        // ✅ 传入折叠状态
        const isCollapsed = false; // 由调用方在 appendNode 中设置

        el.innerHTML = `
            ${NodeTemplates.renderAgentHeader(node, previewText, icon, isCollapsed)}
            <div class="llm-ui-node__body">
                ${NodeTemplates.renderThinking(node.data.thought || '', hasThought, node.status)}
                ${errorHtml}
                <div class="llm-ui-node__output">
                    <div class="llm-ui-mount-point" id="mount-${node.id}"></div>
                </div>
                <div class="llm-ui-node__tty-panels"></div>
                <div class="llm-ui-node__children"></div>
            </div>
        `;

        mounts.output = el.querySelector(`#mount-${node.id}`);
    }
}