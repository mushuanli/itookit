// @file: llm-engine/src/utils/vfs-entity-store.ts

import { BaseModuleService } from '@itookit/vfslib';
import { log } from './logger';

/**
 * VFS JSON 实体的通用 CRUD 配置
 */
export interface EntityStoreConfig {
    /** 存储目录（相对于模块根） */
    dir: string;
    /** 显示图标 */
    icon: string;
    /** 类型标识 */
    typeName: string;
}

/**
 * 实体需要满足的最小接口
 */
export interface Identifiable {
    id: string;
    name: string;
}

/**
 * VFS JSON 实体通用存储操作
 *
 * 提取 saveConnection/saveMCPServer/deleteConnection/deleteMCPServer 的公共模式，
 * 通过组合方式供 VFSAgentService 使用。
 */
export class VFSEntityStore<T extends Identifiable> {
    constructor(
        private service: BaseModuleService,
        private engine: BaseModuleService['engine'],
        private config: EntityStoreConfig
    ) { }

    /**
     * 保存实体（新建或更新），同步更新内存缓存
     */
    async save(entity: T, cache: T[]): Promise<T[]> {
        const filename = `${entity.id}.json`;
        const content = JSON.stringify(entity, null, 2);
        const fullPath = `${this.config.dir}/${filename}`;
        const metadata = {
            icon: this.config.icon,
            title: entity.name,
            type: this.config.typeName
        };

        await this.service.ensureDirectory(this.config.dir);
        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.writeContent(nodeId, content);
            await this.engine.updateMetadata(nodeId, metadata);
        } else {
            await this.engine.createFile(filename, this.config.dir, content, metadata);
        }

        // 更新缓存
        const newCache = [...cache];
        const index = newCache.findIndex(c => c.id === entity.id);
        if (index >= 0) {
            newCache[index] = entity;
        } else {
            newCache.push(entity);
        }

        return newCache;
    }

    /**
     * 删除实体，返回过滤后的缓存
     */
    async delete(id: string, cache: T[]): Promise<T[]> {
        const fullPath = `${this.config.dir}/${id}.json`;
        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.delete([nodeId]);
            log.debug(`${this.config.typeName} file deleted`, { id });
        }

        return cache.filter(c => c.id !== id);
    }
}
