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

/**
 * 负责解析纯业务数据到 UI 表现
 */
class IconResolver {
    static getIcon(node: ExecutionNode): string {
        // 1. 优先使用 metaInfo 中的 agentIcon (从 config 或 persistence 传递过来的)
        if (node.data.metaInfo?.agentIcon) {
            return node.data.metaInfo.agentIcon;
        }

        // 2. 其次检查 agentId
        if (node.data.metaInfo?.agentId === 'default') return '🤖';
        
        switch (node.type) {
            case 'agent': return '🤖'; 
            case 'tool': return '🔧';
            case 'router': return '🔀';
            case 'thought': return '💭';
            default: return '📄';
        }
    }

    static getLayoutClass(node: ExecutionNode): string {
        // 根据 executionMode 决定布局类
        const mode = node.data.metaInfo?.executionMode;
        if (mode === 'concurrent') return 'llm-ui-layout--grid';
        return 'llm-ui-layout--list'; // 默认
    }
}

export class NodeRenderer {
    static create(node: ExecutionNode): RenderResult {
        const el = document.createElement('div');
        
        // 解析 UI 属性
        const icon = IconResolver.getIcon(node);
        const layoutClass = IconResolver.getLayoutClass(node);
        
        // BEM: llm-ui-node llm-ui-node--[type] [layout]
        el.className = `llm-ui-node llm-ui-node--${node.type} ${layoutClass}`;
        el.dataset.id = node.id;
        el.dataset.status = node.status;

        const mountPoints: { output?: HTMLElement } = {};

        if (node.type === 'agent' || node.type === 'router') {
            this.renderAgent(el, node, mountPoints, icon);
        } else if (node.type === 'tool') {
            el.innerHTML = NodeTemplates.renderTool(node, icon);
        } else if (node.type === 'thought') {
            el.innerHTML = NodeTemplates.renderThinking(node.data.thought || '', true);
        }

        return { element: el, mountPoints };
    }

    private static renderAgent(el: HTMLElement, node: ExecutionNode, mounts: any, icon: string) {
        const hasThought = node.data.thought && node.data.thought.length > 0 ? true:false;
        const previewText = node.data.output ? node.data.output.substring(0, 50).replace(/\n/g, ' ') : '';

        el.innerHTML = `
            ${NodeTemplates.renderAgentHeader(node, previewText, icon)}

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