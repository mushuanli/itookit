
/**
 * @file vfs/middleware/base/ContentMiddleware.ts
 * 内容提供者基类和工厂
 */
import { VNodeData, Transaction } from '../../store/types';
import { VFSStorage } from '../../store/VFSStorage';
import { EventBus } from '../../core/EventBus';
import { IVFSMiddleware } from '../../core/types';

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
  async onValidate?(
    vnode: VNode,
    content: string | ArrayBuffer
  ): Promise<void>;

  /**
   * 读取内容前处理
   */
  async onBeforeRead?(vnode: VNode): Promise<void>;

  /**
   * 读取内容后处理
   */
  async onAfterRead?(
    vnode: VNode,
    content: string | ArrayBuffer
  ): Promise<string | ArrayBuffer>;

  /**
   * 写入前处理内容
   */
  async onBeforeWrite?(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<string | ArrayBuffer>;

  /**
   * 写入后处理（提取派生数据）
   */
  async onAfterWrite?(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<Record<string, any>>;

  /**
   * 删除前清理
   */
  async onBeforeDelete?(
    vnode: VNode,
    transaction: Transaction
  ): Promise<void>;

  /**
   * 删除后清理
   */
  async onAfterDelete?(
    vnode: VNode,
    transaction: Transaction
  ): Promise<void>;

  /**
   * 清理资源（Provider 注销时调用）
   */
  async cleanup?(): Promise<void>{}
}
