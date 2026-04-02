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
 *     { ...WS_AGENTS, mentionScope: ['agents', 'prompts'] },
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

export const WS_PROMPTS: WorkspaceConfig = {
    elementId: 'prompt-workspace',
    moduleName: 'prompts',
    slug: 'prompts',
    type: 'standard',
    title: 'Prompts',
    supportedFileTypes: ['prompt'],
    syncEnabled: true,
    mentionAble: true,
    aiEnabled: true,
};
