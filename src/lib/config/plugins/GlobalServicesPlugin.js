// #config/plugins/GlobalServicesPlugin.js

/**
 * @file GlobalServicesPlugin.js
 * @description 全局服务插件，负责注册应用范围内共享的、全局性的业务服务。
 */

import { ServiceScope } from '../core/ServiceContainer.js';
import { TagRepository } from '../repositories/TagRepository.js';
import { LLMRepository } from '../repositories/LLMRepository.js';
import { LLMConfigService } from '../services/LLMConfigService.js';

/**
 * @class GlobalServicesPlugin
 * @description
 * 注册所有全局业务逻辑相关的服务，这些服务都是单例模式。
 * - `tagRepository`: 全局标签仓库。
 * - `llmRepository`: 全局 LLM 配置仓库。
 * - `llmService`: LLM 配置的业务逻辑服务层。
 */
export class GlobalServicesPlugin {
    /**
     * @param {ServiceContainer} container - 服务容器实例。
     */
    install(container) {
        // 注册标签仓库
        container.register('tagRepository',
            // 工厂函数，接收容器 `c` 作为参数
            (c) => new TagRepository(
                // 通过容器 `c` 获取依赖
                c.get('persistenceAdapter'), 
                c.get('eventManager')
            ),
            { 
                scope: ServiceScope.SINGLETON,
                deps: ['persistenceAdapter', 'eventManager'], // 声明依赖
                eager: true // 标记为在应用启动时加载
            }
        );

        // 注册LLM仓库
        container.register('llmRepository',
            (c) => new LLMRepository(c.get('persistenceAdapter'), c.get('eventManager')),
            { 
                scope: ServiceScope.SINGLETON, 
                deps: ['persistenceAdapter', 'eventManager'],
                eager: true 
            }
        );

        // 注册LLM服务
        container.register('llmService',
            (c) => new LLMConfigService(c.get('llmRepository'), c.get('eventManager')),
            {
                scope: ServiceScope.SINGLETON,
                deps: ['llmRepository', 'eventManager']
            }
        );
    }
}
