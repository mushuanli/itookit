// @file llm-ui/components/NodeRenderer.ts
import {escapeHTML} from '@itookit/common';
import { ExecutionNode } from '../types';

export class NodeRenderer {
    /**
     * 创建节点的 DOM 结构
     */
    static create(node: ExecutionNode): HTMLElement {
        const el = document.createElement('div');
        el.className = `execution-node node-type-${node.type}`;
        el.dataset.id = node.id;
        el.dataset.status = node.status;

        if (node.type === 'agent') {
            this.renderAgent(el, node);
        } else if (node.type === 'tool') {
            this.renderTool(el, node);
        } else if (node.type === 'thought') {
            this.renderThought(el, node);
        }

        return el;
    }

    private static renderAgent(el: HTMLElement, node: ExecutionNode) {
        const hasThought = node.data.thought && node.data.thought.length > 0;
        
        el.innerHTML = `
            <div class="agent-card">
                <div class="agent-header">
                    <div class="agent-icon">${node.icon || '🤖'}</div>
                    <div class="agent-info">
                        <span class="agent-name">${node.name}</span>
                        <span class="agent-status-text">${node.status}</span>
                    </div>
                    <div class="agent-timer">0ms</div>
                </div>
                
                <!-- 思维链区域 -->
                <div class="agent-thought-container ${hasThought ? '' : 'collapsed'}" 
                     style="${hasThought ? 'display:block' : 'display:none;'}">
                    <div class="thought-header">
                        <span class="icon">💭</span> Thinking Process
                        <span class="toggle-icon">▼</span>
                    </div>
                    <div class="node-thought-content markdown-body">${escapeHTML(node.data.thought || '')}</div>
                </div>

                <!-- 输出区域 -->
                <div class="agent-output-container">
                    <div class="node-output-content markdown-body">${escapeHTML(node.data.output || '')}</div>
                </div>

                <!-- 子任务容器 -->
                <div class="node-children"></div>
            </div>
        `;

        // 绑定折叠逻辑
        const thoughtHeader = el.querySelector('.thought-header');
        thoughtHeader?.addEventListener('click', () => {
            el.querySelector('.agent-thought-container')?.classList.toggle('collapsed');
        });
    }

    private static renderTool(el: HTMLElement, node: ExecutionNode) {
        el.innerHTML = `
            <div class="tool-card">
                <div class="tool-header">
                    <span class="tool-icon">🔧</span>
                    <span class="tool-name">${node.name}</span>
                    <span class="tool-status status-${node.status}">${node.status}</span>
                </div>
                <div class="tool-args">
                    <code>${JSON.stringify(node.data.toolCall?.args || {})}</code>
                </div>
                <div class="tool-result" style="display:none;"></div>
            </div>
        `;
    }

    private static renderThought(el: HTMLElement, node: ExecutionNode) {
        // 纯思维节点（如路由器的决策过程）
        el.innerHTML = `
            <div class="thought-bubble">
                <span class="thought-icon">🤔</span>
                <span class="node-thought-content"></span>
            </div>
        `;
    }
}