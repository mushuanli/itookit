// @file packages/vfs-middleware/src/builtin/CompositeMiddleware.ts

import { VNodeData, ITransaction } from '../../core';
import { IMiddleware, BaseMiddleware } from '../interfaces/IMiddleware';

/**
 * 组合中间件
 * 将多个中间件组合为一个
 */
export class CompositeMiddleware extends BaseMiddleware {
  readonly name: string;
  readonly priority: number;
  private middlewares: IMiddleware[];

  constructor(name: string, middlewares: IMiddleware[]) {
    super();
    this.name = name;
    this.middlewares = middlewares.sort((a, b) => b.priority - a.priority);
    this.priority = middlewares.length > 0
      ? Math.max(...middlewares.map(m => m.priority))
      : 0;
  }

  canHandle(node: VNodeData): boolean {
    return this.middlewares.some(m => !m.canHandle || m.canHandle(node));
  }

  private getApplicable(node: VNodeData): IMiddleware[] {
    return this.middlewares.filter(m => !m.canHandle || m.canHandle(node));
  }

  async onValidate(node: VNodeData, content: string | ArrayBuffer): Promise<void> {
    for (const m of this.getApplicable(node)) {
      await m.onValidate?.(node, content);
    }
  }

  async onBeforeWrite(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getApplicable(node)) {
      if (m.onBeforeWrite) {
        result = await m.onBeforeWrite(node, result, tx);
      }
    }
    return result;
  }

  async onAfterWrite(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    for (const m of this.getApplicable(node)) {
      if (m.onAfterWrite) {
        Object.assign(data, await m.onAfterWrite(node, content, tx));
      }
    }
    return data;
  }

  async onBeforeDelete(node: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getApplicable(node)) {
      await m.onBeforeDelete?.(node, tx);
    }
  }

  async onAfterDelete(node: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getApplicable(node)) {
      await m.onAfterDelete?.(node, tx);
    }
  }

  async onAfterMove(
    node: VNodeData,
    oldPath: string,
    newPath: string,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getApplicable(node)) {
      await m.onAfterMove?.(node, oldPath, newPath, tx);
    }
  }

  async onAfterCopy(
    source: VNodeData,
    target: VNodeData,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getApplicable(target)) {
      await m.onAfterCopy?.(source, target, tx);
    }
  }

  async onAfterRead(
    node: VNodeData,
    content: string | ArrayBuffer
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getApplicable(node)) {
      if (m.onAfterRead) {
        result = await m.onAfterRead(node, result);
      }
    }
    return result;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.middlewares.map(m => m.dispose?.()));
  }
}
