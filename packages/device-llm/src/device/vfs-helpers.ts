// @file: device-llm/device/vfs-helpers.ts
//
// VFSHelpers — low-level VFS read/write utilities shared across manager classes.

import type { IModuleFS, CreateFileOptions } from '@itookit/stdio';
import yaml from 'js-yaml';

export class VFSHelpers {
    constructor(private readonly engine: IModuleFS) {}

    /** Expose the underlying engine for callers that need raw driver access */
    getEngine(): IModuleFS {
        return this.engine;
    }

    async readJson<T>(path: string, systemFS?: IModuleFS): Promise<T | null> {
        try {
            const fs = systemFS ?? this.engine;
            const nodeId = await fs.driver.resolvePath(path);
            if (!nodeId) return null;
            const raw = await fs.driver.readContent(nodeId);
            const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            return JSON.parse(text) as T;
        } catch { return null; }
    }

    writeJson(path: string, data: unknown, systemFS?: IModuleFS): Promise<void> {
        return this.engineUpsert(path, JSON.stringify(data, null, 2), systemFS);
    }

    async engineUpsert(path: string, content: string, systemFS?: IModuleFS): Promise<void> {
        const fs = systemFS ?? this.engine;
        const nodeId = await fs.driver.resolvePath(path);
        if (nodeId) {
            await fs.driver.writeContent(nodeId, content);
        } else {
            const name = path.substring(path.lastIndexOf('/') + 1);
            const parent = path.substring(0, path.lastIndexOf('/')) || '/';
            await fs.driver.createFile({
                name,
                parentPath: parent,
                content,
                recursive: true,
            } as CreateFileOptions);
        }
    }

    /** Load all YAML (preferred) and JSON (legacy) files from a VFS directory. */
    async loadJsonFilesFromDir<T>(dirPath: string, systemFS?: IModuleFS): Promise<T[]> {
        const items: T[] = [];
        const t0 = performance.now();
        try {
            const fs = systemFS ?? this.engine;
            const dirId = await fs.driver.resolvePath(dirPath);
            if (!dirId) { console.log(`[Boot]       loadDir ${dirPath}: empty`); return []; }
            const children = await fs.driver.getChildren(dirId);
            console.log(`[Boot]       loadDir ${dirPath}: ${children.length} entries`);
            for (const child of children) {
                if (child.type !== 'file') continue;
                const isYaml = child.name.endsWith('.yaml') || child.name.endsWith('.yml');
                const isJson = child.name.endsWith('.json');
                if (!isYaml && !isJson) continue;
                try {
                    const raw = await fs.driver.readContent(child.path);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    const parsed = isYaml
                        ? yaml.load(text) as T
                        : JSON.parse(text) as T;
                    items.push(parsed);
                } catch (e) {
                    console.warn(`[VFSHelpers] loadDir skip ${child.name}:`, e instanceof Error ? e.message : e);
                }
            }
            console.log(`[Boot]       loadDir ${dirPath}: ${items.length} loaded in ${(performance.now() - t0).toFixed(0)}ms`);
        } catch { /* directory not yet created */ }
        return items;
    }
}
