// @file: llm-ui/services/BranchService.ts

import { SessionManager, BranchTreeNode } from '@itookit/llm-engine';

export interface BranchCreateOptions {
    name?: string;
    copyContent: boolean;
}

/**
 * 分支操作服务
 * 职责：分支的创建、删除、重命名、切换
 */
export class BranchService {
    constructor(private sessionManager: SessionManager) { }

    /**
     * 获取分支树
     */
    async getBranchTree(): Promise<BranchTreeNode> {
        return await this.sessionManager.getBranchTree();
    }

    /**
     * 创建分支
     */
    async createBranch(sourceNodeId: string, options: BranchCreateOptions): Promise<void> {
        await this.sessionManager.createBranch(sourceNodeId, options);
    }

    /**
     * 删除分支
     */
    async deleteBranch(nodeId: string, cascade: boolean): Promise<void> {
        await this.sessionManager.deleteBranch(nodeId, cascade);
    }

    /**
     * 重命名分支
     */
    async renameBranch(nodeId: string, newName: string): Promise<void> {
        await this.sessionManager.renameBranch(nodeId, newName);
    }

    /**
     * 切换分支
     */
    async switchBranch(nodeId: string, targetIndex: number): Promise<void> {
        await this.sessionManager.switchToSibling(nodeId, targetIndex);
    }
}
