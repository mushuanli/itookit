import {
    WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_PROMPTS,
    WS_ANKI, WS_PROJECTS, WS_EMAILS, WS_PRIVATE,
} from '@itookit/app-shell';
import type { WorkspaceConfig } from '@itookit/app-shell';

export const WORKSPACES: WorkspaceConfig[] = [
    WS_SETTINGS,
    // Extend agents mentionScope to cover all reachable content modules
    { ...WS_AGENTS, mentionScope: ['agents', 'prompts', 'projects'] },
    WS_ANKI,
    WS_PROMPTS,
    WS_PROJECTS,
    WS_EMAILS,
    WS_PRIVATE,
    WS_CHAT,
];
