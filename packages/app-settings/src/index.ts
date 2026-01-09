// @file: app-settings/index.ts
// 导出样式 (需要在 web-app 中 import '@itookit/settings/style.css')
// 注意：你需要配置构建工具支持 css 导出，或者直接拷贝 css 文件
import './styles/styles.css';
import {    VFS } from '@itookit/vfs';
import { VFSAgentService } from '@itookit/llm-ui';
import { SettingsService } from './services/SettingsService';
import { SettingsEngine } from './engine/SettingsEngine'; 
import { createSettingsFactory } from './factories/settingsFactory';

// 导出类型定义
export * from './types';
// 导出服务 (可选，如果外部需要直接操作数据)
//export { SettingsService };

/**
 * [Facade] Settings 模块聚合初始化函数
 * 统一管理内部依赖顺序 (Service -> Engine -> Factory)
 */
export async function createSettingsModule(vfs: VFS, agentService: VFSAgentService) {
    // 1. 初始化数据服务
    const service = new SettingsService(vfs);
    await service.init();

    // 2. 初始化引擎 (提供侧边栏树结构)
    const engine = new SettingsEngine(service);

    // 3. 创建编辑器工厂 (提供具体的表单 UI)
    const factory = createSettingsFactory(service, agentService);

    return {
        service,
        engine, 
        factory
    };
}