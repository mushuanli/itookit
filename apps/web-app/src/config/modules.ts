import { WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_PROMPTS } from '@itookit/app-shell';
import type { WorkspaceConfig } from '@itookit/app-shell';

export const WORKSPACES: WorkspaceConfig[] = [
    WS_SETTINGS,

    // Agents — extend default mentionScope to cover all reachable content modules
    { ...WS_AGENTS, mentionScope: ['agents', 'prompts', 'projects'] },

    // Web-only workspaces
    {
        elementId: 'anki-workspace',
        moduleName: 'anki',
        slug: 'anki',
        type: 'standard',
        title: 'Anki Memory Cards',
        supportedFileTypes: ['anki', 'markdown'],
        syncEnabled: true,
        plugins: ['cloze:cloze', 'cloze:cloze-controls', 'cloze:memory', 'autocomplete:mention', 'autocomplete:tag'],
        mentionScope: ['*'],
        mentionAble: true,
        aiEnabled: true,
    },

    WS_PROMPTS,

    {
        elementId: 'project-workspace',
        moduleName: 'projects',
        slug: 'projects',
        type: 'standard',
        title: 'Projects',
        supportedFileTypes: ['project'],
        syncEnabled: true,
        mentionAble: true,
        aiEnabled: true,
    },
    {
        elementId: 'email-workspace',
        moduleName: 'emails',
        slug: 'emails',
        type: 'standard',
        title: 'Email Drafts',
        supportedFileTypes: ['email'],
        syncEnabled: true,
        mentionAble: true,
        aiEnabled: true,
    },
    {
        elementId: 'private-workspace',
        moduleName: 'private',
        slug: 'private',
        type: 'standard',
        title: 'Private Notes',
        supportedFileTypes: ['private'],
        syncEnabled: false,
        isProtected: true,
        mentionScope: [],
        mentionAble: true,
        aiEnabled: true,
    },

    WS_CHAT,
];
