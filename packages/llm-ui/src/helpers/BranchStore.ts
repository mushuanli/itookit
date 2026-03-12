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

    constructor(
        private sessionManager: SessionManager,
        private errorHandler: ErrorHandler
    ) { }

    get current(): BranchItem[] {
        return this.branches;
    }

    get currentBranch(): BranchItem | undefined {
        return this.branches.find(b => b.isCurrent);
    }

    async refresh(): Promise<BranchItem[]> {
        const raw = await this.errorHandler.wrapWithFallback(
            () => this.sessionManager.listBranches(), [],
            'Refresh branches', 'warn'
        );

        this.branches = raw.length === 0
            ? [{ name: 'main', headNodeId: '', isCurrent: true }]
            : raw.map(b => ({
                name: b.name,
                headNodeId: b.headNodeId,
                isCurrent: b.isCurrent,
            }));

        this.notify();
        return this.branches;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        this.listeners.forEach(fn => fn());
    }

    destroy(): void {
        this.listeners.clear();
        this.branches = [];
    }
}
