/**
 * @file vfs-ui/src/index.ts
 * @desc Public API entry point for the VFS-UI library.
 */
import './styles/vfs-ui.unified.css';

import { VFSUIManager } from './core/VFSUIManager.js';
import { DirectoryProvider } from './providers/DirectoryProvider.js';
import { FileProvider } from './providers/FileProvider.js';
import { TagProvider } from './providers/TagProvider.js';

import type { SessionUIOptions } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
import type { ISessionManager } from '@itookit/common';
import type { VFSNodeUI } from './types/types.js';
import { VFSService } from './services/VFSService.js';
import type { VFSUIState, UISettings } from './types/types.js'; // ✨ 导入 UISettings

// ✨ [修改] 扩展 VFSUIOptions 类型
type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings> 
};


/**
 * Creates a new VFS-UI instance to manage a specific module from vfs-core.
 *
 * @param options - UI configuration options.
 * @param vfsCore - An initialized vfs-core instance.
 * @param moduleName - The name of the vfs-core module this UI instance will manage.
 * @returns A new manager instance conforming to the ISessionManager interface.
 */
export function createVFSUI(options: VFSUIOptions, vfsCore: VFSCore, moduleName: string): ISessionManager<VFSNodeUI, VFSService> {
    return new VFSUIManager(options, vfsCore, moduleName);
}

// Export main class, providers, and key types for advanced usage.
export { VFSService, VFSUIManager, DirectoryProvider, FileProvider, TagProvider };
export * from './types/types.js';

// [新增] 导出编辑器集成相关的功能和类型
export { connectEditorLifecycle } from './integrations/editor-connector.js';
