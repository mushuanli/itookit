// @file llm-engine/orchestrator/data/TreeOperations.ts

import { ExecutionNode } from '../../core/types';
import { NodeStatus } from '@itookit/llmdriver';
import { SessionState } from '../core/SessionState';

/**
 * 节点树操作管理器
 * 职责：管理执行节点树的增删改查
 */
export class TreeOperations {
    constructor(private state: SessionState) {}

    /**
     * 更新节点数据（追加或替换）
     */
    updateNodeData(
        nodeId: string, 
        data: string, 
        field: 'thought' | 'output', 
        replace = false
    ): void {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    if (replace) {
                        node.data[field] = data;
                    } else {
                        node.data[field] = (node.data[field] || '') + data;
                    }
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    /**
     * 更新节点元数据
     */
    updateNodeMeta(nodeId: string, meta: any): void {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    node.data.metaInfo = { ...node.data.metaInfo, ...meta };
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    /**
     * 设置节点状态
     */
    setNodeStatus(nodeId: string, status: NodeStatus): void {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    node.status = status;
                    if (status === 'success' || status === 'failed') {
                        node.endTime = Date.now();
                    }
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    /**
     * 添加子节点到树中
     */
    addNodeToTree(node: ExecutionNode): void {
        if (!node.parentId) return;
        
        const findAndAdd = (candidates: ExecutionNode[]): boolean => {
            for (const parent of candidates) {
                if (parent.id === node.parentId) {
                    if (!parent.children) parent.children = [];
                    parent.children.push(node);
                    return true;
                }
                if (parent.children && findAndAdd(parent.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndAdd);
    }

    /**
     * 在节点树中查找节点
     */
    findNode(nodeId: string): ExecutionNode | null {
        let found: ExecutionNode | null = null;
        
        const search = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    found = node;
                    return true;
                }
                if (node.children && search(node.children)) return true;
            }
            return false;
        };
        
        this.traverseAllTrees(search);
        return found;
    }

    /**
     * 遍历所有会话的执行树
     */
    private traverseAllTrees(callback: (nodes: ExecutionNode[]) => boolean): void {
        for (const session of this.state.getSessions()) {
            if (session.executionRoot) {
                if (callback([session.executionRoot])) return;
            }
        }
    }
}
