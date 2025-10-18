// config/plugins/ModuleSystemPlugin.js

/**
 * @file ModuleSystemPlugin.js
 * @description 模块化系统插件，负责注册所有与特定工作区/项目绑定的作用域服务。
 */

import { ServiceScope } from '../core/ServiceContainer.js';
import { ModuleRepository } from '../repositories/ModuleRepository.js';
import { SRSRepository } from '../repositories/SRSRepository.js';
import { SRSService } from '../services/SRSService.js';

/**
 * @class ModuleSystemPlugin
 * @description
 * 注册所有作用域（SCOPED）服务。这些服务的实例将由 WorkspaceContext 管理，
 * 确保每个工作区都有自己独立的服务实例。
 */
export class ModuleSystemPlugin {
    /**
     * @param {ServiceContainer} container - 服务容器实例。
     */
    install(container) {
        // 注册模块仓库
        container.register('moduleRepository',
            // 工厂函数接收的第二个参数 `namespace` 将由容器在创建 SCOPED 服务时传入
            (c, namespace) => new ModuleRepository(namespace, c.get('persistenceAdapter'), c.get('eventManager')),
            { 
                scope: ServiceScope.SCOPED, // 关键：声明为作用域服务
                deps: ['persistenceAdapter', 'eventManager'] 
            }
        );

        // 注册SRS仓库
        container.register('srsRepository',
            (c, namespace) => new SRSRepository(namespace, c.get('persistenceAdapter'), c.get('eventManager')),
            { 
                scope: ServiceScope.SCOPED,
                deps: ['persistenceAdapter', 'eventManager']
            }
        );

        // 注册SRS服务，这是一个非常关键的示例
        container.register('srsService',
            (c, namespace) => {
                // 首先，获取当前工作区的上下文
                const workspace = c.workspace(namespace);
                
                // 然后，从该工作区上下文中获取其依赖的服务。
                // 这确保了 SRSService 依赖的 srsRepository 和 moduleRepository
                // 与它自身属于同一个工作区，实现了完美的隔离。
                return new SRSService(
                    workspace.get('srsRepository'),
                    workspace.module, // 使用便捷访问器
                    c.get('eventManager') // EventManager 是全局单例，直接从主容器获取
                );
            },
            { 
                scope: ServiceScope.SCOPED,
                deps: ['srsRepository', 'moduleRepository', 'eventManager']
            }
        );
    }
}
