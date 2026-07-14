// @file: common/i18n/icons.ts
// Single source of truth for all emoji icons and brand colors used across the UI.
//
// Rules:
//   - One concept = one emoji. Never hardcode emoji outside this file.
//   - Colors follow Tailwind 500/600 range for consistency.
//   - Add a new entry here before using an icon in any component.

import type { SkillType } from '../interfaces/skills/skill-types';

// ── Skill types ───────────────────────────────────────────────────────────────

export interface SkillTypeMeta {
    icon:  string;
    color: string;
}

export const SKILL_TYPE_META: Record<SkillType, SkillTypeMeta> = {
    prompt:  { icon: '📝', color: '#10b981' }, // emerald-500
    shell:   { icon: '🖥️', color: '#8b5cf6' }, // violet-500
    mcp:     { icon: '🔌', color: '#f97316' }, // orange-500
    http:    { icon: '🌐', color: '#0ea5e9' }, // sky-500
    builtin: { icon: '⚙️', color: '#6366f1' }, // indigo-500
    custom:  { icon: '🔧', color: '#f59e0b' }, // amber-500
} as const;

// ── MCP transport ─────────────────────────────────────────────────────────────

export type MCPTransport = 'stdio' | 'sse' | 'http';

export const MCP_TRANSPORT_ICONS: Record<MCPTransport, string> = {
    stdio: '🖥️',
    sse:   '📡',
    http:  '🌐',
} as const;

// ── Model capabilities & category ─────────────────────────────────────────────

export interface ModelMeta {
    icon:  string;
    color: string;
}

/** 模型能力标志元数据（对应 LLMModel.supportsXXX 字段，用于能力 badge） */
export const MODEL_CAPABILITY_META: Record<string, ModelMeta> = {
    vision:           { icon: '👁️', color: '#0ea5e9' }, // sky-500
    thinking:         { icon: '🧠', color: '#8b5cf6' }, // violet-500
    tools:            { icon: '🔧', color: '#f97316' }, // orange-500
    audio:            { icon: '🎵', color: '#10b981' }, // emerald-500
    video:            { icon: '🎬', color: '#ef4444' }, // red-500
    structuredOutput: { icon: '📋', color: '#6366f1' }, // indigo-500
} as const;

/** 模型用途分类元数据（对应 LLMModel.category 字段，用于分类 badge） */
export const MODEL_CATEGORY_META: Record<string, ModelMeta> = {
    chat:      { icon: '💬', color: '#10b981' }, // emerald-500
    image:     { icon: '🖼️', color: '#f59e0b' }, // amber-500
    video:     { icon: '🎬', color: '#ef4444' }, // red-500
    audio:     { icon: '🎵', color: '#0ea5e9' }, // sky-500
    embedding: { icon: '🔢', color: '#6366f1' }, // indigo-500
} as const;

// ── MCP / connection status ───────────────────────────────────────────────────

export interface StatusMeta {
    dot:   string;   // ● or ○
    color: string;
}

export const STATUS_META: Record<'connected' | 'error' | 'idle', StatusMeta> = {
    connected: { dot: '●', color: '#10b981' }, // emerald-500
    error:     { dot: '●', color: '#ef4444' }, // red-500
    idle:      { dot: '○', color: '#9ca3af' }, // gray-400
} as const;

// ── Executor / node types ─────────────────────

export const EXECUTOR_TYPE_ICONS: Record<string, string> = {
    agent:     '🤖',
    tool:      '🔧',
    composite: '🔀',
    http:      '🌐',
    script:    '📜',
} as const;

// ── File MIME type icons (MentionPlugin, attachments) ────────────────────────

export function getFileIcon(mimeType: string | undefined, filename?: string): string {
    if (!mimeType && filename) {
        if (filename.endsWith('.md') || filename.endsWith('.mdx')) return '📝';
        return '📄';
    }
    if (!mimeType) return '📎';
    if (mimeType.startsWith('image/'))    return '🖼️';
    if (mimeType === 'text/markdown')     return '📝';
    if (mimeType.startsWith('text/'))     return '📄';
    if (mimeType.startsWith('audio/'))    return '🎵';
    if (mimeType.startsWith('video/'))    return '🎬';
    if (mimeType.includes('pdf'))         return '📋';
    return '📎';
}

// ── Common UI actions ─────────────────────────────────────────────────────────

export const ACTION_ICONS = {
    add:      '➕',
    delete:   '🗑️',
    save:     '💾',
    import:   '📥',
    export:   '📤',
    test:     '🔬',
    copy:     '📋',
    edit:     '✏️',
    search:   '🔍',
    settings: '⚙️',
    refresh:  '🔄',
    close:    '✕',
    help:     '❓',
    ocr:      '🔤',
} as const;

// ── Status / feedback ─────────────────────────────────────────────────────────

export const FEEDBACK_ICONS = {
    success: '✅',
    error:   '❌',
    warning: '⚠️',
    info:    'ℹ️',
    loading: '⏳',
    auth:    '🔐',
    rate:    '⏳',
    notFound:'🔍',
} as const;

// ── Entity shortcuts ──────────────────────────────────────────────────────────

export const ENTITY_ICONS = {
    agent:   '🤖',
    skill:   '⚡',
    mcp:     '🔌',
    llm:     '🧠',
    branch:  '🌿',
    history: '📚',
    nav:     '🧭',
    model:   '🧠',
} as const;

// ── Agent icon picker palette ─────────────────────────────────────────────────

export const AGENT_ICON_PALETTE = [
    '🤖','🧠','💡','🎯','🚀','⚡','🔥','✨',
    '🎨','📝','📊','📈','🔍','🔧','⚙️','🛠️',
    '💻','🖥️','📱','🌐','☁️','🔒','🔑','📡',
    '📚','📖','✏️','🖊️','📌','📎','🗂️','📁',
    '💬','💭','🗨️','👤','👥','🤝','👋','✋',
    '🌟','⭐','🌙','☀️','🌈','🍀','🌸','🌺',
    '🦾','🦿','🕸️','🔮','💎','🏆','🎖️','🥇',
] as const;
