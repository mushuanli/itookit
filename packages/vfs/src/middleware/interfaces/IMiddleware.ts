// @file packages/vfs-middleware/src/interfaces/IMiddleware.ts

import { VNodeData, ITransaction } from '../../core';

/**
 * 中间件接口
 */
export interface IMiddleware {
  /** 中间件名称 */
  readonly name: string;
  
  /** 优先级（数字越大越先执行） */
  readonly priority: number;

  /**
   * 判断是否处理该节点
   */
  canHandle?(node: VNodeData): boolean;

  /**
   * 验证内容
   */
  onValidate?(node: VNodeData, content: string | ArrayBuffer): Promise<void>;

  /**
   * 写入前处理
   */
  onBeforeWrite?(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<string | ArrayBuffer>;

  /**
   * 写入后处理
   */
  onAfterWrite?(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<Record<string, unknown>>;

  /**
   * 删除前处理
   */
  onBeforeDelete?(node: VNodeData, tx: ITransaction): Promise<void>;

  /**
   * 删除后处理
   */
  onAfterDelete?(node: VNodeData, tx: ITransaction): Promise<void>;

  /**
   * 移动后处理
   */
  onAfterMove?(
    node: VNodeData,
    oldPath: string,
    newPath: string,
    tx: ITransaction
  ): Promise<void>;

  /**
   * 复制后处理
   */
  onAfterCopy?(
    source: VNodeData,
    target: VNodeData,
    tx: ITransaction
  ): Promise<void>;

  /**
   * 读取后处理
   */
  onAfterRead?(
    node: VNodeData,
    content: string | ArrayBuffer
  ): Promise<string | ArrayBuffer>;

  /**
   * 清理资源
   */
  dispose?(): Promise<void>;
}

/**
 * 中间件基类
 */
export abstract class BaseMiddleware implements IMiddleware {
  abstract readonly name: string;
  readonly priority: number = 0;

  canHandle(_node: VNodeData): boolean {
    return true;
  }
}
