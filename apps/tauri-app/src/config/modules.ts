import {
    WS_SETTINGS, WS_CHAT, WS_AGENTS, WS_MINDS,
    WS_ANKI, WS_PROJECTS, WS_EMAILS, WS_PRIVATE,
} from '@itookit/app-shell';
import type { WorkspaceConfig } from '@itookit/app-shell';

// Local filesystem workspace — at top as the primary entry point.
// Conceptually equivalent to web-app's Projects but backed by the real OS filesystem.
const WS_HOME: WorkspaceConfig = {
    elementId: 'home-workspace',
    moduleName: 'home',
    slug: 'files',
    type: 'standard',
    title: 'Files',
    supportedFileTypes: ['markdown', 'mind', 'project', 'email', 'private'],
    syncEnabled: false,
    mentionAble: true,
    aiEnabled: true,
};

export const WORKSPACES: WorkspaceConfig[] = [
    WS_SETTINGS,
    WS_HOME,        // local FS at top
    WS_CHAT,
    WS_AGENTS,
    WS_ANKI,
    WS_MINDS,
    WS_PROJECTS,    // stored in appData/IndexedDB — same as web-app
    WS_EMAILS,
    WS_PRIVATE,
];
