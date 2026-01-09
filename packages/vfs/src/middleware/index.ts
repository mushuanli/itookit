// @file packages/vfs-middleware/src/index.ts

export { type IMiddleware, BaseMiddleware } from './interfaces/IMiddleware';
export { MiddlewareRegistry } from './MiddlewareRegistry';
export { CompositeMiddleware } from './builtin/CompositeMiddleware';

// 先导入到当前作用域
import { MiddlewarePlugin } from './MiddlewarePlugin';

// 然后导出
export { MiddlewarePlugin };
export default MiddlewarePlugin;
