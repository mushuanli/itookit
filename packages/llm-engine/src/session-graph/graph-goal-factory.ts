// createGraphGoal + resolveDependencyTree — converts a session's dependency tree
// into a Goal for reconcile().
//
// Each session file becomes a GoalNode:
//   - id = file path
//   - task.prompt = file content (resolved at execution time)
//   - predicate = standard mode → 'done' always; advance mode → 'llm-judge'
//
// resolveDependencyTree() replaces the removed DependencyGraph class — it resolves
// the full dependency tree from VFS (session-meta.json) and returns nodes in
// topological order (leaves first).
//
// Cycle detection: throws CycleError listing the cycle path.

import type { Goal, AgentRunSpec, RunEdge } from '@itookit/common';
import type { SessionType } from './types';
import { SessionMetaStore } from './session-meta-store';
import type { IVFSManager } from '@itookit/common';

// ─── CycleError ────────────────────────────────────────────────────────

export class CycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
    }
}

// ─── Graph Goal Result ─────────────────────────────────────────────────

export interface GraphGoalResult {
    goal: Goal;
    /** Map from node id → (moduleName, path) for execution. */
    nodeMap: Map<string, { moduleName: string; path: string; type: SessionType }>;
}

// ─── Dependency Tree Resolution ────────────────────────────────────────

/**
 * Resolve all dependencies of a session recursively and return them in
 * topological order (leaves first, the target session last).
 *
 * Replaces the removed DependencyGraph.topoSort(). Uses the same DFS-based
 * algorithm but as a free function instead of a class method.
 *
 * @throws CycleError if a cycle is detected.
 */
export async function resolveDependencyTree(
    vfs: IVFSManager,
    moduleName: string,
    sessionPath: string,
    maxDepth = 30,
): Promise<Array<{ moduleName: string; path: string }>> {
    const store = new SessionMetaStore(vfs);
    const sorted: Array<{ moduleName: string; path: string }> = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    async function resolveDeps(
        mod: string,
        sessionBase: string,
        rawDeps: string[],
    ): Promise<Array<{ moduleName: string; path: string }>> {
        const sessionDir = sessionBase.includes('/')
            ? sessionBase.slice(0, sessionBase.lastIndexOf('/'))
            : '/';
        const result: Array<{ moduleName: string; path: string }> = [];

        for (const dep of rawDeps) {
            const resolved = joinPath(sessionDir, dep);
            if (dep.endsWith('/')) {
                const children = await expandDirectory(vfs, mod, resolved.replace(/\/$/, ''));
                children.forEach((p) => result.push({ moduleName: mod, path: p }));
            } else {
                result.push({ moduleName: mod, path: resolved });
            }
        }
        return result;
    }

    async function visit(
        mod: string,
        path: string,
        stackTrace: string[],
        depth: number,
    ): Promise<void> {
        const k = `${mod}:${path}`;
        if (visited.has(k)) return;
        if (inStack.has(k)) throw new CycleError([...stackTrace, path]);
        if (depth <= 0) return;

        inStack.add(k);
        const trace = [...stackTrace, path];

        const meta = await store.read(mod, path);
        const deps = await resolveDeps(mod, path, meta.dependencies);

        for (const dep of deps) {
            await visit(dep.moduleName, dep.path, trace, depth - 1);
        }

        inStack.delete(k);
        visited.add(k);
        sorted.push({ moduleName: mod, path });
    }

    await visit(moduleName, sessionPath, [], maxDepth);
    return sorted;
}

// ─── Path helpers ──────────────────────────────────────────────────────

/** Expand a directory reference to immediate child session files. */
async function expandDirectory(
    vfs: IVFSManager,
    moduleName: string,
    dirPath: string,
): Promise<string[]> {
    const engine = vfs.getEngine(moduleName);
    try {
        const children = await engine.driver.getChildren(dirPath);
        return children
            .filter((n) => n.type === 'file' && !n.name.startsWith('_') && !n.name.startsWith('.'))
            .map((n) => n.path);
    } catch {
        return [];
    }
}

/** Simple VFS path join (no fs module needed). */
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

// ─── Graph Goal Factory ────────────────────────────────────────────────

/**
 * Create a Goal from a session's dependency tree.
 *
 * Uses resolveDependencyTree() to discover all transitive dependencies,
 * then builds GoalNodes + edges for reconcile().
 */
export async function createGraphGoal(
    vfs: IVFSManager,
    moduleName: string,
    sessionPath: string,
    opts?: {
        maxDepth?: number;
        typeOverride?: SessionType;
    },
): Promise<GraphGoalResult> {
    const store = new SessionMetaStore(vfs);

    // Resolve the full dependency tree (topological order, leaves first)
    const order = await resolveDependencyTree(vfs, moduleName, sessionPath, opts?.maxDepth ?? 30);

    const nodeMap = new Map<string, { moduleName: string; path: string; type: SessionType }>();
    const nodes: AgentRunSpec[] = [];

    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const type = opts?.typeOverride ?? meta.type;
        const id = `${item.moduleName}:${item.path}`;

        nodeMap.set(id, { moduleName: item.moduleName, path: item.path, type });

        nodes.push({
            id,
            agent: { id: 'default', version: '1' },
            prompt: item.path,
            mode: 'agent-runtime',
            inputs: [],
            predicate: type === 'advance' ? 'llm-judge' : 'truncation',
            canParallel: false,
            maxRetries: type === 'advance' ? (meta.maxRetries ?? 3) : 1,
        });
    }

    // Build dependency edges from SessionMeta
    const edges: RunEdge[] = [];
    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const toId = `${item.moduleName}:${item.path}`;

        for (const rawDep of meta.dependencies) {
            const resolved = resolveDepPaths(item.moduleName, item.path, rawDep);
            for (const r of resolved) {
                const fromNode = order.find(
                    o => o.moduleName === r.moduleName && o.path === r.path,
                );
                if (fromNode) {
                    const fromId = `${fromNode.moduleName}:${fromNode.path}`;
                    if (!edges.some(e => e.from === fromId && e.to === toId)) {
                        edges.push({ from: fromId, to: toId, kind: 'control' });
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
    return [{ moduleName: mod, path: resolved.replace(/\/$/, '') }];
}
