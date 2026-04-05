/**
 * @file packages/app-shell/src/workspaces/index.ts
 *
 * Pre-defined workspace configs shared across all apps.
 * Import whichever you need and spread-override any field that differs.
 *
 * @example
 *   import { WS_CHAT, WS_AGENTS } from '@itookit/app-shell';
 *   const WORKSPACES = [
 *     WS_CHAT,
 *     { ...WS_AGENTS, mentionScope: ['agents', 'minds'] },
 *   ];
 */

import { FS_MODULE_CHAT, FS_MODULE_AGENTS } from '@itookit/common';
import type { WorkspaceConfig } from '../types';

export const WS_SETTINGS: WorkspaceConfig = {
    elementId: 'settings-workspace',
    moduleName: 'settings_root',
    slug: 'settings',
    type: 'settings',
    title: 'Settings',
    supportedFileTypes: [],
    syncEnabled: false,
    readOnly: true,
    aiEnabled: false,
    mentionAble: false,
};

export const WS_CHAT: WorkspaceConfig = {
    elementId: 'llm-workspace',
    moduleName: FS_MODULE_CHAT,
    slug: 'chat',
    type: 'chat',
    title: 'AI Sessions',
    supportedFileTypes: ['chat'],
    syncEnabled: true,
    mentionScope: ['*'],
    mentionAble: true,
    plugins: [],
    aiEnabled: false,
};

export const WS_AGENTS: WorkspaceConfig = {
    elementId: 'agent-workspace',
    moduleName: FS_MODULE_AGENTS,
    slug: 'agents',
    type: 'agent',
    title: 'Agents',
    supportedFileTypes: ['agent'],
    syncEnabled: true,
    isSystem: true,
    plugins: ['core:titlebar'],
    // Conservative default — apps extend with their reachable modules
    mentionScope: ['agents'],
    mentionAble: false,
    aiEnabled: false,
};

export const WS_MINDS: WorkspaceConfig = {
    elementId: 'minds-workspace',
    moduleName: 'minds',
    slug: 'minds',
    type: 'standard',
    title: 'Minds',
    supportedFileTypes: ['mind'],
    syncEnabled: true,
    mentionAble: true,
    aiEnabled: true,
};

export const WS_ANKI: WorkspaceConfig = {
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
};

export const WS_PROJECTS: WorkspaceConfig = {
    elementId: 'project-workspace',
    moduleName: 'projects',
    slug: 'projects',
    type: 'standard',
    title: 'Projects',
    supportedFileTypes: ['project'],
    syncEnabled: true,
    mentionAble: true,
    aiEnabled: true,
};

export const WS_EMAILS: WorkspaceConfig = {
    elementId: 'email-workspace',
    moduleName: 'emails',
    slug: 'emails',
    type: 'standard',
    title: 'Email Drafts',
    supportedFileTypes: ['email'],
    syncEnabled: true,
    mentionAble: true,
    aiEnabled: true,
};

export const WS_PRIVATE: WorkspaceConfig = {
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
};
