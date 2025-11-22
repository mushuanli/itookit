/**
 * @file vfs-ui/index.ts
 * @desc Public API entry point for the VFS-UI library.
 */
import './styles/vfs-ui.unified.css';
import { VFSUIManager } from './core/VFSUIManager.js';

import type { SessionUIOptions, ISessionUI, ISessionEngine } from '@itookit/common';
import type { VFSNodeUI, VFSUIState, UISettings } from './types/types.js';
import { VFSService } from './services/VFSService.js';

export {FileMentionSource} from './mention/FileMentionSource';
export {DirectoryMentionSource} from './mention/DirectoryMentionSource';

// ✨ [修改] 扩展 VFSUIOptions 类型，增加默认文件配置
type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings>,
    /** [新增] 当没有文件时，要创建的默认文件的文件名。如果未提供，则不创建。 */
    defaultFileName?: string;
    /** [新增] 默认文件的内容，可以是一段帮助文本或模板。 */
    defaultFileContent?: string;
};


/**
 * 创建 VFSUI 实例 (通用引擎模式)
 */
export function createGenericVFSUI(options: VFSUIOptions, engine: ISessionEngine): ISessionUI<VFSNodeUI, VFSService> {
    return new VFSUIManager(options, engine);
}

export { VFSService, VFSUIManager };
export * from './types/types.js';

// [新增] 导出编辑器集成相关的功能和类型
export { connectEditorLifecycle } from './integrations/editor-connector.js';
