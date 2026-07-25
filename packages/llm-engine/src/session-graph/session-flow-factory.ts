import type { FlowRevision, TaskHandlerRef } from '@itookit/common';
import type { SessionType } from './types';
import { SessionMetaStore } from './session-meta-store';
import type { IVFSManager } from '@itookit/common';
import { flowRevisionDigest } from '../task-graph/validation';

export const SESSION_TASK_HANDLER: TaskHandlerRef = {
    kind: 'plugin:session-runtime',
    provider: 'builtin',
    version: '1',
    schemaVersion: 1,
};

export class CycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
    }
}

export interface SessionFlowResult {
    flow: FlowRevision;
    nodeMap: Map<string, { moduleName: string; path: string; type: SessionType }>;
}

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

    async function resolveDeps(mod: string, base: string, dependencies: string[]) {
        const sessionDir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '/';
        const result: Array<{ moduleName: string; path: string }> = [];
        for (const dependency of dependencies) {
            const resolved = joinPath(sessionDir, dependency);
            if (dependency.endsWith('/')) {
                const children = await expandDirectory(vfs, mod, resolved.replace(/\/$/, ''));
                for (const path of children) result.push({ moduleName: mod, path });
            } else {
                result.push({ moduleName: mod, path: resolved });
            }
        }
        return result;
    }

    async function visit(mod: string, path: string, stack: string[], depth: number): Promise<void> {
        const key = `${mod}:${path}`;
        if (visited.has(key)) return;
        if (inStack.has(key)) throw new CycleError([...stack, path]);
        if (depth <= 0) return;
        inStack.add(key);
        const meta = await store.read(mod, path);
        for (const dependency of await resolveDeps(mod, path, meta.dependencies)) {
            await visit(dependency.moduleName, dependency.path, [...stack, path], depth - 1);
        }
        inStack.delete(key);
        visited.add(key);
        sorted.push({ moduleName: mod, path });
    }

    await visit(moduleName, sessionPath, [], maxDepth);
    return sorted;
}

async function expandDirectory(vfs: IVFSManager, moduleName: string, directory: string): Promise<string[]> {
    const engine = vfs.getEngine(moduleName);
    try {
        const children = await engine.driver.getChildren(directory);
        return children
            .filter(node => node.type === 'file' && !node.name.startsWith('_') && !node.name.startsWith('.'))
            .map(node => node.path);
    } catch {
        return [];
    }
}

function joinPath(base: string, relative: string): string {
    if (relative.startsWith('/')) return relative;
    const resolved: string[] = [];
    for (const part of (base + '/' + relative).split('/').filter(Boolean)) {
        if (part === '..') resolved.pop();
        else if (part !== '.') resolved.push(part);
    }
    return '/' + resolved.join('/');
}

export async function createSessionFlow(
    vfs: IVFSManager,
    moduleName: string,
    sessionPath: string,
    opts?: { maxDepth?: number; typeOverride?: SessionType },
): Promise<SessionFlowResult> {
    const store = new SessionMetaStore(vfs);
    const order = await resolveDependencyTree(vfs, moduleName, sessionPath, opts?.maxDepth ?? 30);
    const nodeMap = new Map<string, { moduleName: string; path: string; type: SessionType }>();
    const nodes: FlowRevision['nodes'] = [];

    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const type = opts?.typeOverride ?? meta.type;
        const id = `${item.moduleName}:${item.path}`;
        nodeMap.set(id, { moduleName: item.moduleName, path: item.path, type });
        nodes.push({
            id: id as FlowRevision['nodes'][number]['id'],
            name: item.path,
            handler: SESSION_TASK_HANDLER,
            inputPorts: [],
            outputPorts: [{ name: 'final', required: true, order: 0 }],
            config: { moduleName: item.moduleName, sessionPath: item.path, type },
            joinPolicy: { kind: 'all-success' },
            retryPolicy: { maxAttempts: type === 'advance' ? (meta.maxRetries ?? 3) + 1 : 2, backoff: { kind: 'none' } },
        });
    }

    const edges: FlowRevision['edges'] = [];
    for (const item of order) {
        const meta = await store.read(item.moduleName, item.path);
        const toId = `${item.moduleName}:${item.path}`;
        for (const dependency of meta.dependencies) {
            for (const resolved of resolveDependencyPath(item.moduleName, item.path, dependency)) {
                const fromId = `${resolved.moduleName}:${resolved.path}`;
                if (!order.some(entry => entry.moduleName === resolved.moduleName && entry.path === resolved.path)) continue;
                if (!edges.some(edge => String(edge.from) === fromId && String(edge.to) === toId)) {
                    edges.push({
                        id: `session-edge-${fromId}-${toId}` as never,
                        from: fromId as never,
                        to: toId as never,
                        kind: 'control',
                    });
                }
            }
        }
    }

    const withoutDigest = {
        id: `session-graph-${moduleName}-${sessionPath.replace(/[^a-zA-Z0-9_-]/g, '-')}` as FlowRevision['id'],
        revision: 1,
        name: `Session graph ${moduleName}:${sessionPath}`,
        nodes,
        edges,
        createdAt: Date.now(),
    };
    return { flow: { ...withoutDigest, digest: flowRevisionDigest(withoutDigest) } as FlowRevision, nodeMap };
}

function resolveDependencyPath(
    moduleName: string,
    sessionPath: string,
    dependency: string,
): Array<{ moduleName: string; path: string }> {
    const directory = sessionPath.includes('/') ? sessionPath.slice(0, sessionPath.lastIndexOf('/')) : '/';
    return [{ moduleName, path: joinPath(directory, dependency).replace(/\/$/, '') }];
}


