// @file: common/interfaces/llm/entity-service.ts
// 统一实体服务接口 — provider / connection / agent 持久化实体的缓存读写契约。

/**
 * 统一实体服务接口。
 *
 * 读写语义：
 * - `list` / `get`  从内存缓存同步读取，无 VFS I/O，适合 UI 渲染热路径。
 * - `save` / `delete` 写入持久层并同步更新缓存。
 * - `onChange`  订阅变更，返回取消订阅函数。
 */
export interface IEntityService<T extends { id: string }> {
    /** 从内存缓存同步返回全量列表 */
    list(): T[];
    /** 从内存缓存同步查找单个实体，不存在返回 undefined */
    get(id: string): T | undefined;
    /** 持久化写入（同时更新缓存） */
    save(entity: T): Promise<void>;
    /** 删除（同时更新缓存） */
    delete(id: string): Promise<void>;
    /** 订阅变更，返回取消订阅函数 */
    onChange(cb: () => void): () => void;
}
