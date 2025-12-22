/**
 * @file vfs/core/MiddlewareFactory.ts
 * Middleware 工厂
 * 使用工厂模式简化 Middleware 创建和依赖注入
 */

import { VFSStorage } from '../store/VFSStorage';
import { EventBus } from './EventBus';
import { ContentMiddleware } from '../middleware/base/ContentMiddleware';
import { CompositeMiddleware } from '../middleware/CompositeMiddleware';
// ✨ [新增] 引入接口
import { IVFSMiddleware } from './types';

export class MiddlewareFactory {
  constructor(
    private storage: VFSStorage,
    private eventBus: EventBus
  ) {}

  /**
   * 创建并初始化 Middleware
   * ✨ [修改] 泛型 T 现在扩展自 IVFSMiddleware，不再局限于 ContentMiddleware
   */
  create<T extends IVFSMiddleware>(MiddlewareClass: new () => T): T {
    const middleware = new MiddlewareClass();
    
    // IVFSMiddleware 的 initialize 是可选的，所以要检查
    if (middleware.initialize) {
        middleware.initialize(this.storage, this.eventBus);
    }
    
    return middleware;
  }

  /**
   * 创建组合 Middleware
   */
  createComposite(middlewares: ContentMiddleware[]): CompositeMiddleware {
    const composite = new CompositeMiddleware(middlewares);
    composite.initialize(this.storage, this.eventBus);
    return composite;
  }
}
