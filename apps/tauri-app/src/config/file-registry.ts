/**
 * @file app/config/file-registry.ts
 */
import * as TPL from './templates';

// 定义系统中可用的编辑器类型 key
export type EditorTypeKey = 'standard' | 'agent' | 'chat'; 

export interface AppFileTypeConfig {
    id: string;              // 唯一标识
    label: string;           // 用于 UI 显示 (例如 "Create new [Label]")
    extension: string;       // 文件后缀
    icon?: string;           // 图标 (Emoji 或 URL)
    defaultFileName: string; // 默认创建的文件名
    defaultContent: string;  // 默认文件内容
    editorType: EditorTypeKey; // 核心：指定使用哪个编辑器打开
    duplicateTransformer?: (content: string) => string | Promise<string>;
}

// 文件类型注册表
export const FILE_REGISTRY: Record<string, AppFileTypeConfig> = {
    markdown: {
        id: 'markdown',
        label: 'Note',
        extension: '.md',
        defaultFileName: 'Untitled.md',
        defaultContent: '', 
        editorType: 'standard' // 普通 Markdown 使用标准编辑器
    },
    anki: {
        id: 'anki',
        label: 'Card',
        extension: '.anki', 
        defaultFileName: 'New Card.anki',
        defaultContent: TPL.TPL_ANKI,
        editorType: 'standard' // Anki 也使用标准编辑器（通过插件增强）
    },
    agent: {
        id: 'agent',
        label: 'Agent',
        extension: '.agent',
        icon: '🤖',
        defaultFileName: 'New Assistant.agent',
        defaultContent: TPL.TPL_AGENT,
        editorType: 'agent', // 使用 Agent 专用编辑器
        duplicateTransformer: (content) => {
            try {
                const def = JSON.parse(content);
                def.id = '';  // AgentConfigEditor.setText() auto-generates a new UUID when id is empty
                def.name = `${def.name} (copy)`;
                return JSON.stringify(def, null, 2);
            } catch {
                return content;
            }
        },
    },
    chat: {
        id: 'chat',
        label: 'Chat',
        extension: '.chat',
        icon: '💬',
        defaultFileName: 'New Session.chat',
        defaultContent: TPL.TPL_CHAT,
        editorType: 'chat' // 使用专门的 Chat 编辑器
    },
    prompt: {
        id: 'prompt',
        label: 'Prompt', // [修复]
        extension: '.prompt', // 也是 md，但配置不同
        defaultFileName: 'New Prompt.md',
        defaultContent: TPL.TPL_PROMPT,
        editorType: 'standard'
    },
    project: {
        id: 'project',
        label: 'Project', // [修复]
        extension: '.prj',
        defaultFileName: 'New Project.md',
        defaultContent: TPL.TPL_PROJECT,
        editorType: 'standard'
    },
    // 邮件草稿
    email: {
        id: 'email',
        label: 'Email',
        extension: '.email',
        defaultFileName: 'Draft.md',
        defaultContent: TPL.TPL_EMAIL,
        editorType: 'standard'
    },
    // 私密笔记
    private: {
        id: 'private',
        label: 'Note', // [修复]
        extension: '.private',
        defaultFileName: 'My Private Note.md',
        defaultContent: TPL.TPL_PRIVATE,
        editorType: 'standard'
    },
};
