import {
    WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_MINDS,
    WS_ANKI, WS_PROJECTS, WS_EMAILS, WS_PRIVATE, WS_SKILLS,
} from '@itookit/app-shell';
import type { WorkspaceConfig } from '@itookit/app-shell';

export const WORKSPACES: WorkspaceConfig[] = [
    WS_SETTINGS,
    // Extend agents mentionScope to cover all reachable content modules
    { ...WS_AGENTS, mentionScope: ['agents', 'minds', 'projects'] },
    WS_ANKI,
    WS_PROJECTS,
    WS_MINDS,
    WS_EMAILS,
    WS_PRIVATE,
    WS_SKILLS,
    WS_CHAT,
];
