/**
 * @file vfs-ui/index.ts
 * @desc Public API entry point for the VFS-UI library.
 */
import './styles/index.css';

import { VFSUIShell } from './shell/VFSUIShell';

import type { SessionUIOptions, ISessionUI, IFSEngine, EditorFactory } from '@itookit/common';
import type { VFSNodeUI, VFSUIState, UISettings } from './contracts/types';
import { VFSService } from './services/VFSService';

import type { FileTypeDefinition, CustomEditorResolver } from './services/FileTypeRegistry';

export { FileMentionSource } from './mention/FileMentionSource';
export { DirectoryMentionSource } from './mention/DirectoryMentionSource';
export { createVFSMentionProviders } from './mention/createVFSMentionProviders';

// 修改 Options 类型定义以包含新的配置项
export type VFSUIOptions = SessionUIOptions & {
    initialState?: Partial<VFSUIState>;
    defaultUiSettings?: Partial<UISettings>;
    // [新增]
    fileTypes?: FileTypeDefinition[];
    defaultEditorFactory: EditorFactory;
    customEditorResolver?: CustomEditorResolver;

    /**
     * [新增] 必须在此处定义，以便 createVFSUI 能够识别
     * 用于多实例隔离标识
     */
    scopeId?: string;

    /**
     * 在文件树中显示文件扩展名（如 .md / .ts / .pdf）。
     * 适用于外部文件系统挂载（home / mount）。内部模块保持 false（默认）。
     */
    showFileExtensions?: boolean;
};


/**
 * 创建 VFSUI 实例 (通用引擎模式)
 */
export const createVFSUI = (options: VFSUIOptions, engine: IFSEngine): ISessionUI<VFSNodeUI, VFSService> =>
    new VFSUIShell(options, engine);

export { VFSService, VFSUIShell };
export * from './contracts/types';

export type { FileTypeDefinition, CustomEditorResolver } from './services/FileTypeRegistry';

export { connectEditorLifecycle } from './integrations/editor-connector';
