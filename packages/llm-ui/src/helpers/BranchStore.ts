// @file: llm-ui/helpers/BranchStore.ts

import { BranchItem } from '../base/core/types';
import { SessionManager } from '@itookit/llm-engine';
import { ErrorHandler } from '../utils/errorHandler';

/**
 * Branch 数据的唯一真实来源
 * 
 * 消除 BranchIndicatorView 和 FloatingNavPanel 各自缓存的问题
 */
export class BranchStore {
    private branches: BranchItem[] = [
        { name: 'main', headNodeId: '', isCurrent: true }
    ];
    private listeners = new Set<() => void>();
    private refreshPromise: Promise<BranchItem[]> | null = null;

    constructor(
        private sessionManager: SessionManager,
        private errorHandler: ErrorHandler
    ) { }

    // ================================================================
    // 只读访问
    // ================================================================

    get current(): BranchItem[] {
        return [...this.branches];
    }

    get currentBranch(): BranchItem | undefined {
        return this.branches.find(b => b.isCurrent);
    }

    get count(): number {
        return this.branches.length;
    }

    // ================================================================
    // 刷新（合并并发请求）
    // ================================================================

    /**
     * 刷新 branch 列表
     *
     * 合并并发调用：如果已有进行中的请求，复用其结果。
     * 避免 branch_created + branch_switched 连续触发时的重复请求。
     */
    async refresh(): Promise<BranchItem[]> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.doRefresh();

        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    private async doRefresh(): Promise<BranchItem[]> {
        const raw = await this.errorHandler.wrapWithFallback(
            () => this.sessionManager.listBranches(), [],
            'Refresh branches', 'warn'
        );

        const newBranches: BranchItem[] = raw.length === 0
            ? [{ name: 'main', headNodeId: '', isCurrent: true }] : raw.map(b => ({
                name: b.name,
                headNodeId: b.headNodeId,
                isCurrent: b.isCurrent,
            }));

        // 只在数据实际变化时通知
        if (!this.isEqual(this.branches, newBranches)) {
            this.branches = newBranches;
            this.notify();
        }

        return this.branches;
    }

    // ================================================================
    // 订阅
    // ================================================================

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        this.listeners.forEach(fn => fn());
    }

    // ================================================================
    // 工具
    // ================================================================

    private isEqual(a: BranchItem[], b: BranchItem[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((item, i) =>
            item.name === b[i].name &&
            item.headNodeId === b[i].headNodeId &&
            item.isCurrent === b[i].isCurrent
        );
    }

    destroy(): void {
        this.listeners.clear();
        this.branches = [];
        this.refreshPromise = null;
    }
}

