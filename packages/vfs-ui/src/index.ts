import './styles/index.css';
import { VFSUIShell, type VFSUIShellOptions } from './shell/VFSUIShell';
import type { IFileSystem } from '@itookit/vfs-core';
export type VFSUIOptions = VFSUIShellOptions;
export const createVFSUI = (options: VFSUIOptions, fs: IFileSystem): VFSUIShell => new VFSUIShell(options, fs);
export { VFSUIShell };
export { VFSService } from './services/VFSService';
export type { FileTypeDefinition } from './services/FileTypeRegistry';
export * from './contracts/types';
export type { FileCreationConfig } from './contracts/options';
export type { VFSColumnsOptions } from './shell/ColumnLayout';
export type { VFSToolbarOptions, VFSToolbarContext, VFSToolbarAction } from './ui/components/NodeList/toolbar';

export { createVFSBrowser, VFSBrowser, type BrowserOptions } from './browser/Browser';
export { fromVFS, type VFSDataOptions } from './browser/from-vfs';
export type { BrowserNode, BrowserSource, ResourceRef, SourceChange } from './contracts/source';
export type { BrowserAction, ActionContext } from './browser/actions';
