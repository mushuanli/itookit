// @file: llm-ui/components/history/SessionRenderer.ts

import { SessionGroup, ExecutionNode } from '@itookit/llm-session';
import { MDxController } from '../mdx/MDxController';
import { NodeRenderer } from './NodeRenderer';
import { NodeTemplates } from '../templates/NodeTemplates';
import { LayoutTemplates } from '../templates/LayoutTemplates';
import type { IModuleFS } from '@itookit/stdio';
import { t } from '@itookit/common';
import { TimerManager } from '../common';
import { getPreviewText } from '../../utils/textUtils';
import { IconResolver } from '../../utils/iconResolver';

export interface RendererContext {
    nodeId?: string;
    ownerNodeId?: string;
    moduleFS?: IModuleFS;
}

/**
 * Session/Node 的 DOM 渲染与编辑器生命周期管理
 *
 * 职责：
 * 1. 创建/销毁 session 和 node 的 DOM 结构
 * 2. 管理 MDxController 实例（editorMap）
 * 3. 管理 node 元素引用（nodeMap）
 * 4. 提供内容预览工具
 *
 * 不负责：事件绑定、折叠逻辑、编辑模式、流式更新
 */
export class SessionRenderer {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private renderedSessionIds = new Set<string>();
    private timers = new TimerManager();

    constructor(
        private container: HTMLElement,
        private context: RendererContext,
        private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
    ) { }

    // ================================================================
    // 访问器（供其他 Controller 使用）
    // ================================================================

    get editors(): Map<string, MDxController> { return this.editorMap; }

    getNode(nodeId: string): HTMLElement | null {
        return this.nodeMap.get(nodeId) || null;
    }

    getEditor(nodeId: string): MDxController | undefined {
        return this.editorMap.get(nodeId);
    }

    getSessionElement(sessionId: string): HTMLElement | null {
        return this.container.querySelector(
            `[data-session-id="${sessionId}"]`
        ) as HTMLElement | null;
    }

    isRendered(sessionId: string): boolean {
        return this.renderedSessionIds.has(sessionId);
    }

    // ================================================================
    // Session 渲染
    // ================================================================

    appendSession(group: SessionGroup, isCollapsed: boolean): void {
        if (this.renderedSessionIds.has(group.id)) {
            console.warn(`[SessionRenderer] Duplicate session: ${group.id}`);
            return;
        }
        this.renderedSessionIds.add(group.id);

        const wrapper = document.createElement('div');
        wrapper.className = `llm-ui-session llm-ui-session--${group.role}`;
        wrapper.dataset.sessionId = group.id;

        // origin CSS class + label element
        if (group.origin && group.origin !== 'user') {
            wrapper.classList.add(`llm-ui-session--origin-${group.origin}`);
        }
        if (group.historyPolicy === 'exclude') {
            wrapper.classList.add('llm-ui-session--ephemeral');
        }

        if (group.role === 'user') {
            const preview = getPreviewText(group.content || '');
            wrapper.innerHTML = NodeTemplates.renderUserBubble(group, preview, isCollapsed);
            this.container.appendChild(wrapper);
            this.mountUserEditor(wrapper, group);
        } else {
            // 修复：动态提取图标
            const icon = group.executionRoot
                ? IconResolver.getIcon(group.executionRoot)
                : '🤖';

            const originKey = group.origin === 'agent' || group.origin === 'system'
                ? `chat.origin.${group.origin}` as const
                : null;
            const originLabelHtml = originKey
                ? `<span class="llm-ui-session__origin-label">${t(originKey)}</span>`
                : '';

            wrapper.innerHTML = `
                <div class="llm-ui-avatar">${icon}</div>
                ${originLabelHtml}
                <div class="llm-ui-execution-root" id="container-${group.id}"></div>
            `;
            this.container.appendChild(wrapper);
        }
    }

    /**
     * 渲染执行树（递归）
     */
    renderExecutionTree(node: ExecutionNode, isCollapsed: boolean): void {
        this.appendNode(node.parentId, node, isCollapsed);
        node.children?.forEach(c => this.renderExecutionTree(c, isCollapsed));
    }

    appendNode(parentId: string | undefined, node: ExecutionNode, isCollapsed: boolean): void {
        if (this.nodeMap.has(node.id)) {
            console.warn(`[SessionRenderer] Duplicate node: ${node.id}`);
            return;
        }

        let parentEl: HTMLElement | null = null;
        if (parentId) {
            parentEl = this.nodeMap.get(parentId)?.querySelector('.llm-ui-node__children') || null;
        }
        if (!parentEl) {
            const roots = this.container.querySelectorAll('.llm-ui-execution-root');
            if (roots.length > 0) parentEl = roots[roots.length - 1] as HTMLElement;
        }

        if (!parentEl) return;

        const { element } = NodeRenderer.create(node);

        if (isCollapsed) {
            element.classList.add('is-collapsed');
            const svg = element.querySelector('[data-action="collapse"] svg');
            if (svg) svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
        }

        this.nodeMap.set(node.id, element);
        parentEl.appendChild(element);
        this.mountNodeEditor(element, node);
    }

    // ================================================================
    // 编辑器挂载
    // ================================================================

    private mountUserEditor(wrapper: HTMLElement, group: SessionGroup): void {
        const mountPoint = wrapper.querySelector(`#user-mount-${group.id}`) as HTMLElement;
        if (!mountPoint) return;

        const controller = new MDxController(mountPoint, group.content || '', {
            readOnly: true,
            onChange: (text) => {
                this.onContentChange?.(group.id, text, 'user');
                const previewEl = wrapper.querySelector('.llm-ui-header-preview');
                if (previewEl) previewEl.textContent = getPreviewText(text);
            },
            nodeId: this.context.nodeId,
            ownerNodeId: this.context.ownerNodeId,
            moduleFS: this.context.moduleFS,
        });
        this.editorMap.set(group.id, controller);
    }

    private mountNodeEditor(element: HTMLElement, node: ExecutionNode): void {
        const mountPoint = element.querySelector(`#mount-${node.id}`) as HTMLElement;
        if (!mountPoint) return;

        const sessionEl = element.closest('[data-session-id]');
        const effectiveId = (sessionEl as HTMLElement)?.dataset.sessionId || node.id;

        const isStreaming = node.status === 'running' || node.status === 'queued';

        const controller = new MDxController(mountPoint, node.data.output || '', {
            readOnly: true,
            streaming: isStreaming,
            onChange: (text) => {
                if (controller.isEditing()) {
                    this.onContentChange?.(effectiveId, text, 'node');
                }
            },
            nodeId: this.context.nodeId,
            ownerNodeId: this.context.ownerNodeId,
            moduleFS: this.context.moduleFS,
        });
        this.editorMap.set(node.id, controller);

        const iconEl = element.querySelector('.llm-ui-node__icon--clickable');
        if (iconEl && node.data.metaInfo?.agentId) {
            (iconEl as HTMLElement).dataset.agentId = node.data.metaInfo.agentId;
        }
    }

    // ================================================================
    // 删除
    // ================================================================

    removeMessages(ids: string[], animated: boolean): string[] {
        const removed: string[] = [];

        for (const id of ids) {
            const sessionEl = this.container.querySelector(`[data-session-id="${id}"]`);
            const nodeEl = this.nodeMap.get(id);

            if (!sessionEl && !nodeEl) continue;

            this.renderedSessionIds.delete(id);

            if (sessionEl) this.removeElement(sessionEl as HTMLElement, animated);
            if (nodeEl) {
                this.removeElement(nodeEl, animated);
                this.nodeMap.delete(id);
            }

            const editor = this.editorMap.get(id);
            if (editor) {
                editor.destroy();
                this.editorMap.delete(id);
            }

            removed.push(id);
        }

        const delay = animated ? 350 : 0;
        this.timers.setTimeout(() => this.checkEmpty(), delay);

        return removed;
    }

    private removeElement(el: HTMLElement, animated: boolean): void {
        if (animated) {
            el.classList.add('llm-ui-session--deleting');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            this.timers.setTimeout(() => { if (el.parentNode) el.remove(); }, 350);
        } else {
            el.remove();
        }
    }

    private checkEmpty(): void {
        const remaining = this.container.querySelectorAll(
            '.llm-ui-session:not(.llm-ui-session--deleting)'
        );
        if (remaining.length === 0) {
            this.renderWelcome();
        }
    }

    // ================================================================
    // 简单渲染
    // ================================================================

    renderWelcome(): void {
        this.clear();
        this.container.innerHTML = LayoutTemplates.renderWelcome();
    }

    // ================================================================
    // 工具方法
    // ================================================================

    /**
     * 获取指定 session 关联的所有编辑器 ID
     */
    getEditorIdsForSession(sessionId: string): string[] {
        const ids: string[] = [];
        if (this.editorMap.has(sessionId)) ids.push(sessionId);

        const sessionEl = this.container.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionEl) {
            sessionEl.querySelectorAll('.llm-ui-node[data-id]').forEach(node => {
                const nodeId = (node as HTMLElement).dataset.id;
                if (nodeId && this.editorMap.has(nodeId)) ids.push(nodeId);
            });
        }
        return ids;
    }

    // ================================================================
    // 清理
    // ================================================================

    clear(): void {
        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();
        this.nodeMap.clear();
        this.renderedSessionIds.clear();
        this.container.innerHTML = '';
    }

    destroy(): void {
        this.timers.destroy();
        this.clear();
    }
}
