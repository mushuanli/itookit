// @file: llm-engine/session-graph/session-meta-store.ts
// Reads and writes session metadata from the file's VFS assetdir.
//
// Storage layout for session file "design.md" in module "minds":
//   /design.md              ← the session file (task prompt)
//   /_design.md/            ← VFS assetdir (managed by IAssetOperations)
//     session-meta.json     ← SessionMeta (this module)
//     result.md             ← output written after completion (read by dependents)

import type { IVFSManager } from '@itookit/common';
import { DEFAULT_SESSION_META, type SessionMeta, type SessionStatus } from './types';

const META_ASSET   = 'session-meta.json';
const RESULT_ASSET = 'result.md';

type RawContent = string | ArrayBuffer | Uint8Array | null;

function toString(raw: RawContent): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') return raw;
    return new TextDecoder().decode(raw as ArrayBuffer);
}

/** Low-level store: reads/writes session meta + result via IAssetOperations. */
export class SessionMetaStore {
    constructor(private readonly vfs: IVFSManager) {}

    private getAssets(moduleName: string) {
        const engine = this.vfs.getEngine(moduleName);
        // IModuleFS exposes assets as an optional IAssetOperations capability
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (engine as any).assets as {
            getAsset(path: string, name: string): Promise<RawContent>;
            putAsset(path: string, name: string, content: string): Promise<unknown>;
        } | undefined;
    }

    async read(moduleName: string, sessionPath: string): Promise<SessionMeta> {
        try {
            const assets = this.getAssets(moduleName);
            if (!assets) return { ...DEFAULT_SESSION_META };
            const raw = await assets.getAsset(sessionPath, META_ASSET);
            const text = toString(raw);
            if (!text) return { ...DEFAULT_SESSION_META };
            return { ...DEFAULT_SESSION_META, ...JSON.parse(text) };
        } catch {
            return { ...DEFAULT_SESSION_META };
        }
    }

    async write(moduleName: string, sessionPath: string, meta: SessionMeta): Promise<void> {
        const assets = this.getAssets(moduleName);
        if (!assets) throw new Error(`Module "${moduleName}" does not support asset operations`);
        await assets.putAsset(sessionPath, META_ASSET, JSON.stringify(meta, null, 2));
    }

    async updateStatus(
        moduleName: string,
        sessionPath: string,
        status: SessionStatus,
        extra?: Partial<Pick<SessionMeta, 'completedAt' | 'lastError' | 'runCount'>>,
    ): Promise<void> {
        const meta = await this.read(moduleName, sessionPath);
        await this.write(moduleName, sessionPath, { ...meta, status, ...extra });
    }

    /** Write the session's output so dependents can read it as context. */
    async writeResult(moduleName: string, sessionPath: string, output: string): Promise<void> {
        const assets = this.getAssets(moduleName);
        if (!assets) return;
        await assets.putAsset(sessionPath, RESULT_ASSET, output);
    }

    /** Read a dependency's result (injected as context when executing dependents). */
    async readResult(moduleName: string, sessionPath: string): Promise<string | null> {
        try {
            const assets = this.getAssets(moduleName);
            if (!assets) return null;
            return toString(await assets.getAsset(sessionPath, RESULT_ASSET));
        } catch {
            return null;
        }
    }

    /** Read the session file's content to use as the task prompt. */
    async readPrompt(moduleName: string, sessionPath: string): Promise<string> {
        try {
            const raw = await this.vfs.read(moduleName, sessionPath);
            return toString(raw as RawContent) ?? `Task: ${sessionPath}`;
        } catch {
            return `Task: ${sessionPath}`;
        }
    }

    /** Declare dependencies for a session file. */
    async setDependencies(
        moduleName: string,
        sessionPath: string,
        dependencies: string[],
        type: SessionMeta['type'] = 'standard',
    ): Promise<void> {
        const meta = await this.read(moduleName, sessionPath);
        await this.write(moduleName, sessionPath, { ...meta, dependencies, type });
    }
}
