/**
 * @file vfs/core/ProviderFactory.ts
 * Provider 工厂
 * 使用工厂模式简化 Provider 创建和依赖注入
 */

import { VFSStorage } from '../store/VFSStorage.js';
import { EventBus } from './EventBus.js';
import { ContentProvider } from '../provider/base/ContentProvider.js';
import { CompositeProvider } from '../provider/CompositeProvider.js';

export class ProviderFactory {
  constructor(
    private storage: VFSStorage,
    private eventBus: EventBus
  ) {}

  /**
   * 创建并初始化 Provider
   */
  create<T extends ContentProvider>(ProviderClass: new () => T): T {
    const provider = new ProviderClass();
    provider.initialize(this.storage, this.eventBus);
    return provider;
  }

  /**
   * 创建组合 Provider（组合模式）
   */
  createComposite(providers: ContentProvider[]): CompositeProvider {
    const composite = new CompositeProvider(providers);
    composite.initialize(this.storage, this.eventBus);
    return composite;
  }
}
