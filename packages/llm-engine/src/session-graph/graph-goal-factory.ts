// createGraphGoal — converts a session's dependency tree into a Goal for reconcile().
//
// Each session file becomes a GoalNode:
//   - id = file path
//   - task.prompt = file content (resolved at execution time)
//   - predicate = standard mode → 'done' always; advance mode → 'llm-judge'
//
// The existing DependencyGraph.topoSort() is used to resolve the full
// dependency tree, then nodes + edges are extracted into Goal format.

import type { Goal, GoalNode } from '@itookit/common';
import type { SessionType } from './types';
import { DependencyGraph } from './dependency-graph';
import { SessionMetaStore } from './session-meta-store';
import type { IVFSManager } from '@itookit/common';

export interface GraphGoalResult {
    goal: Goal;
    /** Map from node id → (moduleName, path) for execution. */
    nodeMap: Map<string, { moduleName: string; path: string; type: SessionType }>;
}

export async function createGraphGoal(
    vfs: IVFSManager,
    moduleName: string,
    sessionPath: string,
    opts?: {
        maxDepth?: number;
        typeOverride?: SessionType;
    },
): Promise<GraphGoalResult> {
    const graph = new DependencyGraph(vfs);
    const store = new SessionMetaStore(vfs);

    // Resolve the full dependency tree
    const order = await graph.topoSort(moduleName, sessionPath, opts?.maxDepth ?? 30);

    const nodeMap = new Map<string, { moduleName: string; path: string; type: SessionType }>();
    const nodes: GoalNode[] = [];

    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const type = opts?.typeOverride ?? meta.type;
        const id = `${item.moduleName}:${item.path}`;

        nodeMap.set(id, { moduleName: item.moduleName, path: item.path, type });

        nodes.push({
            id,
            task: {
                prompt: item.path, // resolved to file content at execution time
                mode: 'agent-runtime',
                context: { moduleName: item.moduleName, path: item.path, type },
            },
            predicate: type === 'advance' ? 'llm-judge' : 'truncation',
            canParallel: false, // Session graph is sequential (bottom-up)
            maxRetries: type === 'advance' ? (meta.maxRetries ?? 3) : 1,
        });
    }

    // Build dependency edges from SessionMeta
    const edges: Array<[string, string]> = [];
    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const toId = `${item.moduleName}:${item.path}`;

        // Resolve each dependency to its concrete session path(s)
        for (const rawDep of meta.dependencies) {
            const resolved = resolveDepPaths(item.moduleName, item.path, rawDep);
            for (const r of resolved) {
                // Find the actual node in the order
                const fromNode = order.find(
                    o => o.moduleName === r.moduleName && o.path === r.path,
                );
                if (fromNode) {
                    const fromId = `${fromNode.moduleName}:${fromNode.path}`;
                    if (!edges.some(([f, t]) => f === fromId && t === toId)) {
                        edges.push([fromId, toId]);
                    }
                }
            }
        }
    }

    return {
        goal: {
            id: `${moduleName}:${sessionPath}`,
            nodes,
            edges: edges.length > 0 ? edges : undefined,
        },
        nodeMap,
    };
}

/** Resolve a dependency string to concrete (moduleName, path) pairs. */
function resolveDepPaths(
    mod: string,
    sessionPath: string,
    dep: string,
): Array<{ moduleName: string; path: string }> {
    const sessionDir = sessionPath.includes('/')
        ? sessionPath.slice(0, sessionPath.lastIndexOf('/'))
        : '/';
    const resolved = joinPath(sessionDir, dep);

    // For directory deps, we can't expand here without VFS access.
    // The DependencyGraph handles this during topoSort.
    // Here we just return the resolved path.
    return [{ moduleName: mod, path: resolved.replace(/\/$/, '') }];
}

function joinPath(base: string, rel: string): string {
    if (rel.startsWith('/')) return rel;
    const parts = (base + '/' + rel).split('/').filter(Boolean);
    const resolved: string[] = [];
    for (const p of parts) {
        if (p === '..') resolved.pop();
        else if (p !== '.') resolved.push(p);
    }
    return '/' + resolved.join('/');
}
