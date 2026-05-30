// @file: common/interfaces/llm/entity-service.ts
// 统一实体服务接口 — provider / connection / agent 持久化实体的缓存读写契约。

/** 实体变更事件 — 接收方可据此做增量 patch 而非全量 rebuild */
export interface EntityChangeEvent<T extends { id: string } = { id: string }> {
    type: 'created' | 'updated' | 'deleted';
    id: string;
    /** 变更后的完整实体（created/updated 时存在，deleted 时为 undefined） */
    entity?: T;
}

/**
 * 统一实体服务接口。
 *
 * 读写语义：
 * - `list` / `get`  从内存缓存同步读取，无 VFS I/O，适合 UI 渲染热路径。
 * - `save` / `delete` 写入持久层并同步更新缓存。
 * - `onChange`  订阅变更，回调收到 EntityChangeEvent 含变更类型+id+实体。
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
    /** 订阅变更，回调收到变更事件（类型+id），可据此增量更新 */
    onChange(cb: (event: EntityChangeEvent<T>) => void): () => void;
}
