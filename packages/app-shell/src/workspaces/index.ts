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

/** Skills workspace — VFSUIShell list backed by SkillsEngine + SkillSettingsEditor (form-only). */
export const WS_SKILLS: WorkspaceConfig = {
    elementId:        'skills-workspace',
    moduleName:       'skills',
    slug:             'skills',
    type:             'skills',   // handled by SkillsWorkspaceStrategy in bootstrap.ts
    title:            'Skills',
    supportedFileTypes: [],
    syncEnabled:      false,
    readOnly:         false,
    mentionAble:      false,
    aiEnabled:        false,
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

/**
 * Local filesystem workspace — primary entry point for desktop apps.
 * Backend wiring (LocalFSBackend, driver) is the app's responsibility.
 */
export const WS_HOME: WorkspaceConfig = {
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

/**
 * Factory for dynamically-mounted local directory workspaces.
 * Each mount gets a unique id (e.g. 'mnt_1234567890') and its own VFS module.
 * Backend wiring is the caller's responsibility.
 */
export function createWsMount(id: string, label: string): WorkspaceConfig {
    return {
        elementId: `${id}-workspace`,
        moduleName: id,
        slug: id,
        type: 'standard',
        title: label,
        supportedFileTypes: ['markdown'],
        syncEnabled: false,
        mentionAble: false,
        aiEnabled: true,
    };
}
