// @file: llm-conversation/src/flow/graph.ts
// DAG 图算法：环检测（回边 + 环上节点）。供 validation / executor / CLI 复用，
// 消除三处 Kahn / DFS 重复实现。

export interface GraphNode { id: string; }
export interface GraphEdge { id: string; from: string; to: string; }

export interface GraphCycles {
    /** 环上的边 id（回边），size===0 表示无环。 */
    backEdges: Set<string>;
    /** 环上出现的所有节点 id。 */
    loopNodes: Set<string>;
}

/**
 * DFS 找环：返回回边与环上节点。backEdges 为空即 DAG。
 * loopNodes 用于 Loop 的迭代语义（环上节点可重入）。
 */
export function findCycles(nodes: GraphNode[], edges: GraphEdge[]): GraphCycles {
    const backEdges = new Set<string>();
    const loopNodes = new Set<string>();
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
        const next = adjacency.get(edge.from) ?? [];
        next.push(edge.id);
        adjacency.set(edge.from, next);
    }
    const edgeById = new Map(edges.map(edge => [edge.id, edge]));
    const visited = new Set<string>();
    const stack: string[] = [];
    const inStack = new Set<string>();
    const visit = (nodeId: string): void => {
        visited.add(nodeId);
        stack.push(nodeId);
        inStack.add(nodeId);
        for (const edgeId of adjacency.get(nodeId) ?? []) {
            const to = edgeById.get(edgeId)?.to;
            if (to === undefined) continue;
            if (inStack.has(to)) {
                backEdges.add(edgeId);
                const fromIndex = stack.indexOf(to);
                for (let i = fromIndex; i < stack.length; i++) loopNodes.add(stack[i]);
            } else if (!visited.has(to)) {
                visit(to);
            }
        }
        stack.pop();
        inStack.delete(nodeId);
    };
    for (const node of nodes) if (!visited.has(node.id)) visit(node.id);
    return { backEdges, loopNodes };
}
