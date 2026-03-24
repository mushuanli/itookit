// @file: app-settings/index.ts
import './styles/styles.css';
import type { IVFSManager } from '@itookit/common';
import { VFSAgentService } from '@itookit/llm-ui';
import { SettingsService } from './services/SettingsService';
import { SettingsEngine } from './engine/SettingsEngine'; 
import { createSettingsFactory } from './factories/settingsFactory';

// 导出类型定义
export * from './types/types';

/**
 * [Facade] Settings 模块聚合初始化函数
 */
export async function createSettingsModule(vfs: IVFSManager, agentService: VFSAgentService) {
    const service = new SettingsService(vfs);
    await service.init();

    const engine = new SettingsEngine(service);
    const factory = createSettingsFactory(service, agentService);

    return {
        service,
        engine, 
        factory
    };
}
