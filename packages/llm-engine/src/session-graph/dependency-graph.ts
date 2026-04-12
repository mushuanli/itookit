// @file: llm-engine/session-graph/dependency-graph.ts
// Resolves file-path dependencies into a topologically sorted execution order.
//
// Dependency formats (relative to the declaring session file's directory):
//   "./other.md"    → single session
//   "./subdir/"     → all session files directly inside subdir (one level)
//   "../shared.md"  → parent-level session
//
// Cycle detection: throws CycleError listing the cycle path.
// Directory expansion is non-recursive (only immediate children) to keep
// the graph predictable; users nest directories for deeper dependency trees.

import type { IVFSManager } from '@itookit/common';
import { SessionMetaStore } from './session-meta-store';

export class CycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
    }
}

/** Canonical key: "<moduleName>:<path>" */
function key(mod: string, path: string): string {
    return `${mod}:${path}`;
}

export class DependencyGraph {
    private readonly store: SessionMetaStore;

    constructor(private readonly vfs: IVFSManager) {
        this.store = new SessionMetaStore(vfs);
    }

    /**
     * Resolve all dependencies of a session recursively and return them in
     * topological order (leaves first, the target session last).
     * @throws CycleError if a cycle is detected.
     */
    async topoSort(
        moduleName: string,
        sessionPath: string,
        maxDepth = 30,
    ): Promise<Array<{ moduleName: string; path: string }>> {
        const sorted: Array<{ moduleName: string; path: string }> = [];
        const visited = new Set<string>();
        const inStack = new Set<string>();

        await this.visit(moduleName, sessionPath, sorted, visited, inStack, [], maxDepth);
        return sorted;
    }

    /** Expand a directory reference to immediate child session files. */
    async expandDirectory(moduleName: string, dirPath: string): Promise<string[]> {
        const engine = this.vfs.getEngine(moduleName);
        try {
            const children = await engine.getChildren(dirPath);
            return children
                .filter((n) => n.type === 'file' && !n.name.startsWith('_') && !n.name.startsWith('.'))
                .map((n) => n.path);
        } catch {
            return [];
        }
    }

    private async visit(
        mod: string,
        path: string,
        sorted: Array<{ moduleName: string; path: string }>,
        visited: Set<string>,
        inStack: Set<string>,
        stackTrace: string[],
        depth: number,
    ): Promise<void> {
        const k = key(mod, path);
        if (visited.has(k)) return;
        if (inStack.has(k)) throw new CycleError([...stackTrace, path]);
        if (depth <= 0) return;

        inStack.add(k);
        const trace = [...stackTrace, path];

        const meta = await this.store.read(mod, path);
        const deps = await this.resolveDeps(mod, path, meta.dependencies);

        for (const dep of deps) {
            await this.visit(dep.moduleName, dep.path, sorted, visited, inStack, trace, depth - 1);
        }

        inStack.delete(k);
        visited.add(k);
        sorted.push({ moduleName: mod, path });
    }

    /** Resolve raw dependency strings to (moduleName, path) pairs. */
    private async resolveDeps(
        mod: string,
        sessionPath: string,
        rawDeps: string[],
    ): Promise<Array<{ moduleName: string; path: string }>> {
        const sessionDir = sessionPath.includes('/')
            ? sessionPath.slice(0, sessionPath.lastIndexOf('/'))
            : '/';
        const result: Array<{ moduleName: string; path: string }> = [];

        for (const dep of rawDeps) {
            const resolved = this.joinPath(sessionDir, dep);
            if (dep.endsWith('/')) {
                // Directory reference → expand to immediate children
                const children = await this.expandDirectory(mod, resolved.replace(/\/$/, ''));
                children.forEach((p) => result.push({ moduleName: mod, path: p }));
            } else {
                result.push({ moduleName: mod, path: resolved });
            }
        }
        return result;
    }

    /** Simple VFS path join (no fs module needed). */
    private joinPath(base: string, rel: string): string {
        if (rel.startsWith('/')) return rel;
        const parts = (base + '/' + rel).split('/').filter(Boolean);
        const resolved: string[] = [];
        for (const p of parts) {
            if (p === '..') resolved.pop();
            else if (p !== '.') resolved.push(p);
        }
        return '/' + resolved.join('/');
    }
}
