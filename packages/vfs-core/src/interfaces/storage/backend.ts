/**
 * @file packages/vfs-core/src/interfaces/storage/backend.ts
 * @desc 统一 path-based 存储后端接口
 *
 * v4.1: 废弃 IInodeStore / IMetaStore / IContentStore 三层分离。
 * 后端使用 path 作为主键，统一暴露类 fs.promises API。
 *
 * 可选能力（transaction / symlink / search / records）通过鸭子类型暴露。
 * 不支持的实现将对应属性设为 undefined 或不定义。
 */

import type { FSNode, FSSearchQuery } from '../core/types';
import type { IRecordStore } from './record-backend';

export interface IStorageBackend {
    readonly name: string;

    // ── 结构操作 ──

    /** 获取节点信息 */
    stat(path: string): Promise<FSNode | null>;

    /** 列出子节点 */
    list(path: string): Promise<FSNode[]>;

    /** 创建目录 */
    mkdir(path: string): Promise<FSNode>;

    /** 删除节点 */
    delete(path: string, options?: { recursive?: boolean }): Promise<void>;

    /** 重命名/移动 */
    rename(fromPath: string, toPath: string): Promise<void>;

    // ── 内容操作 ──

    /** 读取文件内容 */
    read(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array>;

    /** 写入文件内容 */
    write(path: string, content: Uint8Array): Promise<FSNode>;

    // ── 元数据 ──

    /** 更新元数据（合并语义） */
    updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void>;

    /** 设置标签（全量替换） */
    setTags(path: string, tags: string[]): Promise<void>;

    /** 获取所有已使用的标签 */
    getAllTags(): Promise<string[]>;

    // ── 选配能力（不支持的后端返回 undefined） ──

    /** SeqFile K-V 记录存储 */
    records?: IRecordStore;

    /** 全文/标签搜索 */
    search?(query: FSSearchQuery): Promise<FSNode[]>;

    /** 创建符号链接 */
    symlink?(linkPath: string, target: string): Promise<void>;

    /** 读取符号链接目标 */
    readlink?(path: string): Promise<string>;

    /** 事务（tx 复用 IStorageBackend 接口） */
    transaction?<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T>;

    // ── 生命周期 ──

    init(): Promise<void>;
    close(): Promise<void>;
}

/** 类型守卫：检查后端是否有记录存储 */
export function hasRecordStore(
    backend: IStorageBackend,
): backend is IStorageBackend & { records: IRecordStore } {
    return backend.records != null;
}
