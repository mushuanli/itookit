// shell/index.ts
/**
 * @file vfs-ui/shell/index.ts
 * @desc Public API entry point for the VFS-UI library.
 */

import { VFSUIShell } from './VFSUIShell';

import type {
    SessionUIOptions,
    ISessionUI,
    IFSEngine,
    EditorFactory,
} from '@itookit/common';

import type {
  VFSNodeUI,
  VFSUIState,
  UISettings,
} from '../contracts/types';

import type { FileTypeDefinition, CustomEditorResolver } from '../services/FileTypeRegistry';
import { VFSService } from '../services/VFSService';

export type VFSUIOptions = SessionUIOptions & {
    initialState?: Partial<VFSUIState>;
    defaultUiSettings?: Partial<UISettings>;
    fileTypes?: FileTypeDefinition[];
    defaultEditorFactory: EditorFactory;
    customEditorResolver?: CustomEditorResolver;
    scopeId?: string;
};

/**
 * Create a VFS-UI instance with the given engine.
 * @param options Configuration options
 * @param engine The session engine implementation
 * @returns A new ISessionUI instance
 */
export const createVFSUI = (
    options: VFSUIOptions,
    engine: IFSEngine
): ISessionUI<VFSNodeUI, VFSService> => new VFSUIShell(options, engine);

export { VFSUIShell, VFSService };
export * from '../contracts/types';
export * from '../contracts/commands';
export * from '../contracts/events';
export type { FileTypeDefinition, CustomEditorResolver } from '../services/FileTypeRegistry';
export { connectEditorLifecycle } from '../integrations/editor-connector';

// Re-export mention sources
export { FileMentionSource } from '../mention/FileMentionSource';
export { DirectoryMentionSource } from '../mention/DirectoryMentionSource';
