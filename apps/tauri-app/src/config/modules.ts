/**
 * @file apps/tauri-app/src/config/modules.ts
 *
 * Workspace definitions for the Tauri app.
 *
 * Key difference from web-app:
 *  - 'home' workspace is mounted via LocalFSBackend (transparent to real FS).
 *  - Dynamic mount workspaces are added at runtime by LocalMountService.
 *  - All other modules are stored in FsBackend at appDataDir.
 */
import { FS_MODULE_CHAT, FS_MODULE_AGENTS } from '@itookit/common';

export type WorkspaceType = 'standard' | 'settings' | 'agent' | 'chat';

export interface WorkspaceConfig {
    elementId: string;
    moduleName: string;
    type?: WorkspaceType;
    title: string;
    supportedFileTypes: string[];
    syncEnabled: boolean;
    isProtected?: boolean;
    isSystem?: boolean;
    plugins?: string[];
    mentionScope?: string[];
    mentionAble?: boolean;
    aiEnabled?: boolean;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
    /** True = backend is LocalFSBackend (home dir). False = FsBackend (appDataDir). */
    isLocalFS?: boolean;
}

export const WORKSPACES: WorkspaceConfig[] = [
    // --- Settings (virtual engine, no VFS storage) ---
    {
        elementId:          'settings-workspace',
        moduleName:         'settings_root',
        syncEnabled:        false,
        type:               'settings',
        title:              'Settings',
        supportedFileTypes: [],
        readOnly:           true,
        aiEnabled:          false,
        mentionAble:        false,
    },

    // --- Home: local working directory (LocalFSBackend) ---
    {
        elementId:          'home-workspace',
        moduleName:         'home',
        syncEnabled:        false,
        type:               'standard',
        title:              'Files',
        // markdown is the primary type (new-file button creates .md).
        // Listing additional types here allows the correct editor/icon for each
        // extension, but .chat files open with MDxEditor showing raw JSON since
        // the home workspace doesn't have an LLM session engine.
        supportedFileTypes: ['markdown', 'prompt', 'project', 'email', 'private'],
        mentionAble:        true,
        aiEnabled:          true,
        isLocalFS:          true,
    },

    // --- Chat (FsBackend at appDataDir) ---
    {
        elementId:          'llm-workspace',
        moduleName:         FS_MODULE_CHAT,
        syncEnabled:        true,
        type:               'chat',
        title:              'AI Sessions',
        supportedFileTypes: ['chat'],
        mentionScope:       ['*'],
        mentionAble:        true,
        plugins:            [],
        aiEnabled:          false,
    },

    // --- Agents ---
    {
        elementId:          'agent-workspace',
        moduleName:         FS_MODULE_AGENTS,
        syncEnabled:        true,
        isSystem:           true,
        type:               'agent',
        title:              'Agents',
        supportedFileTypes: ['agent'],
        plugins:            ['core:titlebar'],
        mentionScope:       ['agents'],
        mentionAble:        false,
        aiEnabled:          false,
    },

    // --- Prompts ---
    {
        elementId:          'prompt-workspace',
        moduleName:         'prompts',
        syncEnabled:        true,
        type:               'standard',
        title:              'Prompts',
        supportedFileTypes: ['prompt'],
        mentionAble:        true,
        aiEnabled:          true,
    },

    // --- Settings ---
];

export const MENTIONABLE_MODULES: string[] = WORKSPACES
    .filter(ws => ws.mentionAble === true)
    .map(ws => ws.moduleName);
