// @file: app-settings/index.ts
import './styles/styles.css';
import type { IVFSManager } from '@itookit/common';
import { SettingsService } from './services/SettingsService';
import { SettingsEngine } from './engine/SettingsEngine';

export * from './types/types';
export { createSettingsFactory } from './factories/settingsFactory';
export { SkillsEngine } from './engine/SkillsEngine';

/**
 * Settings 模块初始化。
 *
 * 使用方式：
 *   const settingsModule = await createSettingsModule(vfs);
 *   const settingsFactory = createSettingsFactory(
 *       settingsModule.service,
 *       agentService,
 *       vfsCore.devices,  // IDeviceManager，供 ConnectionSettingsEditor 使用
 *   );
 */
export async function createSettingsModule(vfs: IVFSManager) {
    const service = new SettingsService(vfs);
    await service.init();
    const engine = new SettingsEngine(service);
    return { service, engine };
}
