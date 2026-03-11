// @file: llm-ui/views/history/EditController.ts

import { MDxController } from '../mdx/MDxController';
import type { NodeActionCallback } from '../../base/core/types';

/**
 * 编辑模式控制器
 *
 * 职责：
 * 1. 跟踪哪些节点正在编辑
 * 2. 保存原始内容用于取消
 * 3. 进入/确认/取消编辑模式
 *
 * 不负责：DOM 渲染、折叠、流式
 */
export class EditController {
    private editingNodes = new Set<string>();
    private originalContent = new Map<string, string>();

    constructor(
        private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
        private onNodeAction?: NodeActionCallback,
    ) { }

    isEditing(nodeId: string): boolean {
        return this.editingNodes.has(nodeId);
    }

    // ================================================================
    // User Bubble 编辑
    // ================================================================

    toggleUserEdit(
        nodeId: string,
        controller: MDxController,
        actionsEl: HTMLElement,
        wrapper: HTMLElement
    ): void {
        if (!this.editingNodes.has(nodeId)) {
            this.enterEdit(nodeId, controller, actionsEl, wrapper);
        } else {
            this.confirmEdit(nodeId, controller, actionsEl, wrapper, false);
        }
    }

    private enterEdit(
        nodeId: string,
        controller: MDxController,
        actionsEl: HTMLElement,
        wrapper: HTMLElement
    ): void {
        this.originalContent.set(nodeId, controller.content);
        this.editingNodes.add(nodeId);
        controller.toggleEdit();
        actionsEl.style.display = 'flex';
        wrapper.querySelector('[data-action="edit"]')?.classList.add('active');

        // 如果折叠了，先展开
        const bubble = wrapper.querySelector('.llm-ui-bubble--user');
        if (bubble?.classList.contains('is-collapsed')) {
            const collapseBtn = wrapper.querySelector('[data-action="collapse"]') as HTMLElement;
            collapseBtn?.click();
        }
    }

    confirmEdit(
        nodeId: string,
        controller: MDxController,
        actionsEl: HTMLElement,
        wrapper: HTMLElement,
        regenerate: boolean
    ): void {
        const newContent = controller.content;

        this.editingNodes.delete(nodeId);
        this.originalContent.delete(nodeId);
        controller.toggleEdit();
        actionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');

        this.onContentChange?.(nodeId, newContent, 'user');
        if (regenerate) {
            this.onNodeAction?.('edit-and-retry', nodeId);
        }
    }

    cancelEdit(
        nodeId: string,
        controller: MDxController,
        actionsEl: HTMLElement,
        wrapper: HTMLElement
    ): void {
        const original = this.originalContent.get(nodeId);
        if (original !== undefined) {
            controller.setContent(original);
        }

        this.editingNodes.delete(nodeId);
        this.originalContent.delete(nodeId);
        controller.toggleEdit();
        actionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');
    }

    // ================================================================
    // Node 编辑
    // ================================================================

    async toggleNodeEdit(
        _nodeId: string,
        sessionId: string,
        controller: MDxController,
        actionEl: Element
    ): Promise<void> {
        const wasEditing = controller.isEditing();
        await controller.toggleEdit();
        actionEl.classList.toggle('active');

        if (wasEditing) {
            this.onContentChange?.(sessionId, controller.content, 'node');
        }
    }

    // ================================================================
    // 清理
    // ================================================================

    cleanup(nodeId: string): void {
        this.editingNodes.delete(nodeId);
        this.originalContent.delete(nodeId);
    }

    destroy(): void {
        this.editingNodes.clear();
        this.originalContent.clear();
    }
}
