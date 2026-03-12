// @file: llm-ui/helpers/NavDataBuilder.ts

import { SessionGroup, SessionManager } from '@itookit/llm-engine';
import { ChatNavItem, NavPanelData } from '../views/FloatingNavPanel';
import { BranchItem, CollapseStateMap } from '../base/core/types';
import { getPreviewText } from '../utils/textUtils';

/**
 * 导航面板数据构建器
 * 
 * 职责：将 SessionManager 的数据转换为 FloatingNavPanel 需要的格式
 * 单一职责：数据转换，不涉及 UI
 */
export class NavDataBuilder {
    constructor(private sessionManager: SessionManager) { }

    async build(
        sessions: SessionGroup[],
        collapseStates: CollapseStateMap,
        branches: BranchItem[],
        currentSessionId?: string
    ): Promise<NavPanelData> {
        let items: ChatNavItem[];

        try {
            const branchTree = await this.sessionManager.getBranchTree();
            items = this.buildFromTree(sessions, collapseStates, branchTree);
        } catch (e) {
            console.warn('[NavDataBuilder] Branch tree unavailable, using flat list');
            items = this.buildFlat(sessions, collapseStates);
        }

        return { items, branches, currentSessionId };
    }

    private buildFromTree(
        sessions: SessionGroup[],
        collapseStates: CollapseStateMap,
        branchTree: any
    ): ChatNavItem[] {
        const nodeMap = new Map<string, any>();
        const walk = (node: any) => {
            nodeMap.set(node.id, node);
            node.children?.forEach(walk);
        };
        walk(branchTree);

        return sessions.map((session, index) => {
            const persistedId = session.persistedNodeId || session.id;
            const treeNode = nodeMap.get(persistedId);

            return {
                id: session.id,
                role: session.role,
                preview: getPreviewText(
                    session.content || session.executionRoot?.data.output || '', 30
                ),
                isCollapsed: collapseStates[session.id] ?? false,
                index,
                timestamp: session.timestamp,
                agentName: session.executionRoot?.name,
                branchName: session.branchInfo?.name,
                siblingIndex: session.siblingIndex,
                siblingCount: session.siblingCount,
                hasChildren: (treeNode?.children?.length || 0) > 0,
                memberOfBranches: treeNode?.memberOfBranches || [],
                childBranches: this.extractChildBranches(treeNode),
            };
        });
    }

    private buildFlat(
        sessions: SessionGroup[],
        collapseStates: CollapseStateMap
    ): ChatNavItem[] {
        return sessions.map((session, index) => ({
            id: session.id,
            role: session.role,
            preview: getPreviewText(
                session.content || session.executionRoot?.data.output || '', 30
            ),
            isCollapsed: collapseStates[session.id] ?? false,
            index,
            timestamp: session.timestamp,
            agentName: session.executionRoot?.name,
            branchName: session.branchInfo?.name,
            siblingIndex: session.siblingIndex,
            siblingCount: session.siblingCount,
            hasChildren: session.branchInfo?.hasChildren,
            memberOfBranches: session.branchInfo?.name ? [session.branchInfo.name] : [],
        }));
    }

    private extractChildBranches(treeNode: any): ChatNavItem['childBranches'] {
        if (!treeNode?.children || treeNode.children.length <= 1) return undefined;

        const branchMap = new Map<string, any>();
        for (const child of treeNode.children) {
            const branchName = child.memberOfBranches?.[0];
            if (branchName && !branchMap.has(branchName)) {
                branchMap.set(branchName, {
                    name: branchName,
                    headNodeId: child.id,
                    isCurrent: child.isOnActivePath || false,
                });
            }
        }

        return branchMap.size > 1 ? Array.from(branchMap.values()) : undefined;
    }

}
