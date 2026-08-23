/**
 * @file packages/vfs-core/src/impl/capabilities/TagOps.ts
 * @desc 标签能力实现。依赖 EnginePort 而非 ModuleFS 具体类。
 */

import type { ITagOperations, TagDefinition } from '../../protocol';
import type { EnginePort } from './EnginePort';

export class TagOps implements ITagOperations {
    constructor(private readonly fs: EnginePort) {}

    async getAllTags(): Promise<TagDefinition[]> {
        const tags = await this.fs.backend.getAllTags();
        return tags.map(t => ({ name: t }));
    }

    async setTags(path: string, tags: string[]): Promise<void> {
        const { realPath } = await this.fs.resolveNode(path);
        await this.fs.backend.setTags(realPath, tags);
        this.emitTagUpdate(path);
    }

    async addTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = [...new Set([...node.tags, tag])];
        await this.fs.backend.setTags(realPath, newTags);
        this.emitTagUpdate(path);
    }

    async removeTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = node.tags.filter(t => t !== tag);
        await this.fs.backend.setTags(realPath, newTags);
        this.emitTagUpdate(path);
    }

    private emitTagUpdate(path: string): void {
        this.fs.emit('node:updated', {
            nodes: [{ path, changedFields: ['tags'] }],
            reason: 'tags',
        });
    }

    async walkByTag(tag: string, callback: (path: string) => boolean | Promise<boolean>): Promise<{ total: number; processed: number }> {
        // Walk the tree internally (engine) — capability traversal is not a public CRUD op.
        let processed = 0;
        await this.fs.engine.walkTree(this.fs.toRealPath('/'), (node) => {
            const virtual = this.fs.toVirtualNode(node);
            if (virtual.tags.includes(tag)) {
                processed++;
                return callback(virtual.path);
            }
            return true;
        });
        return { total: processed, processed };
    }
}
