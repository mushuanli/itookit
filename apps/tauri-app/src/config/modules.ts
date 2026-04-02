import { WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_PROMPTS } from '@itookit/app-shell';
import type { WorkspaceConfig } from '@itookit/app-shell';

export const WORKSPACES: WorkspaceConfig[] = [
    WS_SETTINGS,

    // Tauri-only: transparent local filesystem workspace
    {
        elementId: 'home-workspace',
        moduleName: 'home',
        slug: 'files',
        type: 'standard',
        title: 'Files',
        supportedFileTypes: ['markdown', 'prompt', 'project', 'email', 'private'],
        syncEnabled: false,
        mentionAble: true,
        aiEnabled: true,
    },

    WS_CHAT,
    WS_AGENTS,
    WS_PROMPTS,
];
