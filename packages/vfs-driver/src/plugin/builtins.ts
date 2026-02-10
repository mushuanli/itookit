// @vfs-driver/plugin/builtins.ts

import type { MiddlewarePlugin } from '../interface/plugin';

export const loggerPlugin: MiddlewarePlugin = {
  name: 'logger',
  version: '1.0.0',
  type: 'middleware',
  priority: 0,

  middleware() {
    return async (ctx, next) => {
      const start = Date.now();
      try {
        await next();
        console.log(
          `[VFS] ${ctx.operation} ${ctx.path} OK (${Date.now() - start}ms)`,
        );
      } catch (err) {
        console.error(
          `[VFS] ${ctx.operation} ${ctx.path} FAIL (${Date.now() - start}ms)`,
          err,
        );
        throw err;
      }
    };
  },
};
