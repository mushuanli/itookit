/**
 * @file apps/web-app/src/config/modules.ts
 */
import { FS_MODULE_CHAT, FS_MODULE_AGENTS } from '@itookit/common';

// 1. 定义工作区行为类型 (决定 Layout 和 Engine 策略)
export type WorkspaceType = 'standard' | 'settings' | 'agent' | 'chat';

export interface moduleConfig{

};

// 2. 基础系统配置
export interface SystemConfig {
    elementId: string;
    moduleName: string;
    type?: WorkspaceType;
    isProtected?: boolean;
    /** System modules bypass VFS access control (hidden files, cross-module access) */
    isSystem?: boolean;
    plugins?: string[];
    mentionScope?: string[];
    /**
     * Whether files in this module can be discovered by other workspaces' mention search.
     * Default: false. System/config modules should not be mentionable.
     *
     * Note: this is orthogonal to mentionScope (which controls the *outgoing* search scope
     * when the user types @ in THIS workspace's editor).
     */
    mentionAble?: boolean;
    aiEnabled?: boolean;
}

// 3. 混合类型：配置现在只需引用文件类型的 Key
export interface WorkspaceConfig extends SystemConfig {
    title: string;

    // ✨ 核心优化：不再硬编码文件属性，而是指定支持的文件类型 ID
    // 数组的第一个元素将作为该工作区 "新建文件" 按钮的默认类型
    supportedFileTypes: string[];
    syncEnabled: boolean,

    searchPlaceholder?: string;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
}


export const WORKSPACES: WorkspaceConfig[] = [
    // --- Settings (配置化管理) ---
    {
        elementId: 'settings-workspace',
        moduleName: 'settings_root',
        syncEnabled: false,
        type: 'settings',
        title: 'Settings',
        supportedFileTypes: [], // 不支持创建文件
        readOnly: true,
        aiEnabled: false,
        mentionAble: false,
        initialSidebarCollapsed: false
    },

    // --- Agent Workspace ---
    {
        elementId: 'agent-workspace',
        moduleName: FS_MODULE_AGENTS,
        syncEnabled: true,
        isSystem: true, // needs to write hidden files (.connections, .agents, etc.)

        type: 'agent',
        title: 'Agents',
        supportedFileTypes: ['agent'], // 仅支持 agent
        plugins: ['core:titlebar'],
        // Agent 可能需要引用 Prompts 和 Knowledge Base (Projects)
        mentionScope: ['agents', 'prompts', 'projects'],
        mentionAble: false, // agent definitions are internal, not user content to reference
        aiEnabled: false
    },

    // --- Anki Workspace ---
    {
        elementId: 'anki-workspace',
        moduleName: 'anki',
        syncEnabled: true,
        type: 'standard',
        title: 'Anki Memory Cards',
        // 既支持 Anki 卡片，也支持普通 Markdown
        supportedFileTypes: ['anki', 'markdown'],
        plugins: [
            'cloze:cloze',
            'cloze:cloze-controls',
            'cloze:memory',
            'autocomplete:mention',
            'autocomplete:tag'
        ],
        mentionScope: ['*'],  // resolved to MENTIONABLE_MODULES at runtime
        mentionAble: true,
        aiEnabled: true
    },

    // --- Prompt Workspace ---
    {
        elementId: 'prompt-workspace',
        moduleName: 'prompts',
        syncEnabled: true,
        type: 'standard',
        title: 'Prompt Library',
        supportedFileTypes: ['prompt'],
        mentionAble: true,
        aiEnabled: true
    },
    {
        elementId: 'project-workspace',
        moduleName: 'projects',
        syncEnabled: true,
        type: 'standard',
        title: 'Projects',
        supportedFileTypes: ['project'],
        mentionAble: true,
        aiEnabled: true
    },
    // --- Email Workspace ---
    {
        elementId: 'email-workspace',
        moduleName: 'emails',
        syncEnabled: true,
        type: 'standard',
        title: 'Email Drafts',
        supportedFileTypes: ['email'],
        mentionAble: true,
        aiEnabled: true
    },

    // --- Private Workspace ---
    {
        elementId: 'private-workspace',
        moduleName: 'private',
        syncEnabled: false,
        isProtected: true,
        type: 'standard',
        title: 'Private Notes',
        supportedFileTypes: ['private'],
        mentionScope: [],   // no outgoing mention autocomplete in private workspace
        mentionAble: true,  // but private files CAN be referenced from other workspaces
        aiEnabled: true
    },

    // --- LLM Workspace ---
    {
        elementId: 'llm-workspace',
        moduleName: FS_MODULE_CHAT,
        syncEnabled: true,
        type: 'chat',
        title: 'AI Sessions',
        supportedFileTypes: ['chat'],
        mentionScope: ['*'],
        mentionAble: true,
        plugins: [],
        aiEnabled: false
    }
];

/**
 * The set of module names whose files can appear in other workspaces' @ mention results.
 * Excludes system/internal modules (settings, agents, __config).
 *
 * Used to resolve mentionScope: ['*'] to a concrete, bounded list — preventing settings
 * and internal modules from polluting mention results and pushing user content out of
 * the limit window due to module iteration order.
 */
export const MENTIONABLE_MODULES: string[] = WORKSPACES
    .filter(ws => ws.mentionAble === true)
    .map(ws => ws.moduleName);
