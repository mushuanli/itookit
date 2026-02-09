// @vfs-driver/plugin/middleware.ts

import type {
  MiddlewareHandler,
  OperationContext,
  IMiddlewarePipeline,
} from '../interface/plugin';

export class MiddlewarePipeline implements IMiddlewarePipeline {
  private handlers: Array<{ priority: number; handler: MiddlewareHandler }> = [];

  add(handler: MiddlewareHandler, priority: number = 100): void {
    this.handlers.push({ priority, handler });
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  remove(handler: MiddlewareHandler): void {
    const idx = this.handlers.findIndex((h) => h.handler === handler);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }

  async execute(
    operation: string,
    path: string,
    args: Record<string, unknown>,
    coreFn: () => Promise<unknown>,
  ): Promise<unknown> {
    const context: OperationContext = {
      operation,
      path,
      args,
      result: undefined,
      state: new Map(),
      startTime: Date.now(),
    };

    let index = 0;
    const handlers = this.handlers;

    const next = async (): Promise<void> => {
      if (index < handlers.length) {
        const current = handlers[index++];
        await current.handler(context, next);
      } else {
        // 所有中间件执行完毕，执行核心操作
        context.result = await coreFn();
      }
    };

    await next();
    return context.result;
  }
}
