export { initApp } from './bootstrap';
export { WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_PROMPTS } from './workspaces/index';
export type { AppOptions, AppHandle, WorkspaceConfig, WorkspaceType, AdditionalMount } from './types';
export { FILE_REGISTRY } from './config/file-registry';
export type { AppFileTypeConfig, EditorTypeKey } from './config/file-registry';
export * from './config/templates';
export { StandardWorkspaceStrategy, SettingsWorkspaceStrategy, ChatWorkspaceStrategy } from './strategies/index';
export type { WorkspaceStrategy } from './strategies/types';
