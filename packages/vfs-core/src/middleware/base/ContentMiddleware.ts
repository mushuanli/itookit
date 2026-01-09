
/**
 * @file vfs/middleware/base/ContentMiddleware.ts
 * 内容提供者基类和工厂
 */
import { VNodeData } from '../../store/types';
import { VFSStorage } from '../../store/VFSStorage';
import { EventBus } from '../../core/EventBus';
import { IVFSMiddleware } from '../../core/types';
import { ITransaction } from '../../storage/interfaces/IStorageAdapter';

/**
 * 内容中间件基类
 */
export abstract class ContentMiddleware implements IVFSMiddleware {
  /**
   * Middleware 唯一名称
   */
  abstract readonly name: string;

  /**
   * Middleware 优先级（数字越大优先级越高）
   */
  abstract readonly priority: number;

  protected storage?: VFSStorage;
  protected eventBus?: EventBus;

  /**
   * 初始化 Middleware
   */
  initialize(storage: VFSStorage, eventBus: EventBus): void {
    this.storage = storage;
    this.eventBus = eventBus;
  }

  /**
   * 检查是否可以处理该节点
   */
  canHandle(_vnode: VNodeData): boolean {
    return true; // 默认处理所有节点
  }

  /**
   * 验证内容
   */
  async onValidate?(_vnode: VNodeData, _content: string | ArrayBuffer): Promise<void>;

  /**
   * 读取内容前处理
   */
  async onBeforeRead?(_vnode: VNodeData): Promise<void>;

  /**
   * 读取内容后处理
   */
  async onAfterRead?(
    _vnode: VNodeData,
    content: string | ArrayBuffer
  ): Promise<string | ArrayBuffer>;

  /**
   * 写入前处理内容
   */
  async onBeforeWrite?(
    _vnode: VNodeData,
    content: string | ArrayBuffer,
    _tx: ITransaction
  ): Promise<string | ArrayBuffer>;

  /**
   * 写入后处理（提取派生数据）
   */
  async onAfterWrite?(
    _vnode: VNodeData,
    _content: string | ArrayBuffer,
    _tx: ITransaction
  ): Promise<Record<string, unknown>>;

  async onBeforeDelete?(_vnode: VNodeData, _tx: ITransaction): Promise<void>;

  async onAfterDelete?(_vnode: VNodeData, _tx: ITransaction): Promise<void>;

  async onAfterMove?(
    _vnode: VNodeData,
    _oldPath: string,
    _newPath: string,
    _tx: ITransaction
  ): Promise<void>;

  async onAfterCopy?(
    _sourceNode: VNodeData,
    _targetNode: VNodeData,
    _tx: ITransaction
  ): Promise<void>;

  /**
   * 清理资源（Provider 注销时调用）
   */
  async cleanup?(): Promise<void>{}
}
