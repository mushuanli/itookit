/**
 * @file vfs/core/MiddlewareFactory.ts
 * Middleware 工厂
 * 使用工厂模式简化 Middleware 创建和依赖注入
 */

import { VFSStorage } from '../store/VFSStorage';
import { EventBus } from './EventBus';
import { ContentMiddleware } from '../middleware/base/ContentMiddleware';
import { CompositeMiddleware } from '../middleware/CompositeMiddleware';

export class MiddlewareFactory {
  constructor(
    private storage: VFSStorage,
    private eventBus: EventBus
  ) {}

  /**
   * 创建并初始化 Middleware
   */
  create<T extends ContentMiddleware>(MiddlewareClass: new () => T): T {
    const middleware = new MiddlewareClass();
    middleware.initialize(this.storage, this.eventBus);
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
