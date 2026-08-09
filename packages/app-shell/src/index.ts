import './styles/workspace.css';

export { initApp } from './bootstrap';
export { WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_MINDS, WS_ANKI, WS_PROJECTS, WS_EMAILS, WS_PRIVATE, WS_SKILLS, WS_HOME, createWsMount } from './workspaces/index';
export type {
    AppOptions,
    AppHandle,
    AppHarnessPlatform,
    WorkspaceConfig,
    WorkspaceType,
    AdditionalMount,
    WorkbenchConfig,
} from './types';
export { FILE_REGISTRY } from './config/file-registry';
export type { AppFileTypeConfig, EditorTypeKey } from './config/file-registry';
export * from './config/templates';
export { StandardWorkspaceStrategy, SettingsWorkspaceStrategy, ChatWorkspaceStrategy } from './strategies/index';
export type { WorkspaceStrategy } from './strategies/types';
export { themeService } from './ThemeService';
export type { ThemeMode } from './ThemeService';
export { Workbench } from './core/Workbench';
