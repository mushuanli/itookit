export type { DirectorySourceProvider } from './files/directory-mounts';
export { workspaceRoot } from './files/workspace-paths';
import './styles/workspace.css';

export { initApp } from './bootstrap';
export { SessionFilesService } from './files/session-files';
export type { SessionMountRecord, FilesRecord } from './files/session-files';
export { createVFSToolContext } from './files/tool-context';
export { WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_MINDS, WS_ANKI, WS_PROJECTS, WS_EMAILS, WS_PRIVATE, WS_SKILLS, WS_FLOWS, WS_HOME, createWsMount } from './workspaces/index';
export type {
    AppOptions,
    AppHandle,
    AppKernelPlatform,
    WorkspaceConfig,
    WorkspaceType,
    AdditionalMount,
    WorkbenchConfig,
    AppUI,
    ChatEditorDeps,
    FlowEditorDeps,
    AIContextMenuDeps,
    AIContextMenuNode,
} from './types';
export { FILE_REGISTRY } from './config/file-registry';
export type { AppFileTypeConfig, EditorTypeKey } from './config/file-registry';
export * from './config/templates';
export { themeService } from './ThemeService';
export type { ThemeMode } from './ThemeService';
export { Workbench } from './core/Workbench';
