/**
 * @file vfs-ui/index.ts
 * @desc Public API entry point for the VFS-UI library.
 */
import './styles/index.css';

import { VFSUIManager } from './core/VFSUIManager.js';

import type { SessionUIOptions, ISessionUI, ISessionEngine,EditorFactory } from '@itookit/common';
import type { VFSNodeUI, VFSUIState, UISettings } from './types/types.js';
import { VFSService } from './services/VFSService.js';

// [新增] 导入类型
import type { FileTypeDefinition, CustomEditorResolver } from './services/IFileTypeRegistry';

export {FileMentionSource} from './mention/FileMentionSource';
export {DirectoryMentionSource} from './mention/DirectoryMentionSource';

// 修改 Options 类型定义以包含新的配置项
type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings>,
    /** [新增] 当没有文件时，要创建的默认文件的文件名。如果未提供，则不创建。 */
    defaultFileName?: string;
    /** [新增] 默认文件的内容，可以是一段帮助文本或模板。 */
    defaultFileContent?: string;
    // [新增]
    fileTypes?: FileTypeDefinition[];
    defaultEditorFactory: EditorFactory;
    customEditorResolver?: CustomEditorResolver;
    
    /** 
     * [新增] 必须在此处定义，以便 createVFSUI 能够识别
     * 用于多实例隔离标识
     */
    scopeId?: string; 
};


/**
 * 创建 VFSUI 实例 (通用引擎模式)
 */
export function createVFSUI(options: VFSUIOptions, engine: ISessionEngine): ISessionUI<VFSNodeUI, VFSService> {
    return new VFSUIManager(options, engine);
}

export { VFSService, VFSUIManager };
export * from './types/types.js';

// [新增] 导出文件注册相关接口
export type { FileTypeDefinition, CustomEditorResolver, IFileTypeRegistry } from './services/IFileTypeRegistry';

export { connectEditorLifecycle } from './integrations/editor-connector.js';
