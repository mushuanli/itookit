/**
 * @file apps/web-app/src/config/modules.ts
 */
import { FS_MODULE_CHAT, FS_MODULE_AGENTS } from '@itookit/common';
import { DEFAULT_AGENT_CONTENT } from '@itookit/llm-ui';

// 1. 定义工作区行为类型
export type WorkspaceType = 'standard' | 'settings' | 'agent' | 'chat';

// 2. 定义必须从 UI 选项中分离出来的系统逻辑字段
export interface SystemConfig {
    elementId: string;
    moduleName: string;
    
    // 核心逻辑控制
    type?: WorkspaceType; 
    isProtected?: boolean;
    
    // 插件与 AI 逻辑
    plugins?: string[]; 
    mentionScope?: string[];
    aiEnabled?: boolean; // 控制是否启用后台 Brain
}

// 3. 混合类型：SystemConfig + UI 参数
// 注意：这里的字段名必须与 MemoryManager 的 UIOptions 接口保持一致
// 这样在 main.ts 中可以直接透传，无需逐个映射
export interface WorkspaceConfig extends SystemConfig {
    // --- 直接透传给 MemoryManager 的 UI 字段 ---
    title: string;
    createFileLabel: string; // (原 itemLabel，改名以匹配组件接口)
    
    defaultFileName?: string;
    defaultExtension?: string;
    defaultFileContent?: string;
    
    searchPlaceholder?: string;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
    
    // 如果 MemoryManager 将来支持 sidebarWidth, 只需要在这里加定义即可：
    // sidebarWidth?: number;
}


export const WORKSPACES: WorkspaceConfig[] = [
    // --- Settings (配置化管理) ---
    {
        elementId: 'settings-workspace',
        moduleName: 'settings_root', // 对应 SettingsEngine 的 moduleName
        type: 'settings',
        title: 'Settings',
        createFileLabel: 'Setting',
        readOnly: true, // 整个列表只读
        aiEnabled: false,
        plugins: ['core:titlebar'],
        initialSidebarCollapsed: false
    },

    // --- Agent Workspace ---
    {
        elementId: 'agent-workspace',
        moduleName: FS_MODULE_AGENTS,
        type: 'agent',
        title: 'Agents',
        createFileLabel: 'Agent',
        defaultFileName: 'New Assistant.agent',
        defaultExtension: '.agent',
        // 默认内容为合法的 JSON 字符串
        defaultFileContent: JSON.stringify(DEFAULT_AGENT_CONTENT, null, 2),
        // Agent 编辑器只需要最基础的 Titlebar 插件
        plugins: ['core:titlebar'],
        // Agent 可能需要引用 Prompts 和 Knowledge Base (Projects)
        mentionScope: ['agents', 'prompts', 'projects'],
        aiEnabled: false
    },

    // --- Anki Workspace ---
    {
        elementId: 'anki-workspace',
        moduleName: 'anki',
        type: 'standard',
        title: 'Anki Memory Cards',
        createFileLabel: 'Card',
        plugins: [
            'cloze:cloze', 
            'cloze:cloze-controls', 
            'autocomplete:mention', 
            'autocomplete:tag'
        ], 
        defaultFileName: 'Anki Guide.md',
        defaultExtension: '.md',
        defaultFileContent: `### 挖空填词 (Cloze)

这是通过 \`cloze\` 插件启用的功能。在预览模式下，点击挖空部分即可显示/隐藏答案。
**控制面板**: 请留意屏幕右下角的浮动控制面板，支持 **切换摘要/详细视图**。

- **基本用法**: --太阳-- 是太阳系的中心。
- **带 ID**: [c1]--地球-- 是我们居住的行星。
- **带音频**: 法语单词 "你好" 的发音是 --Bonjour--^^audio:Bonjour^^。

** 多行与长文本支持 (使用 ¶ 换行) **:
MDxEditor 识别 \`¶\` 字符作为挖空内部的换行符。

**1. 短多行示例**:
--第一行内容¶第二行内容 (点击查看完整布局)--

**2. 长文本自动摘要示例**:
(在控制面板点击 <i class="fas fa-compress-alt"></i> 按钮可切换视图)

--Markdown 是一种轻量级标记语言，创始人为 John Gruber。¶它允许人们使用易读易写的纯文本格式编写文档，然后将其转换成有效的 XHTML (或者 HTML)。¶Markdown 的目标是实现"易读易写"。¶这份演示文档本身就是用 Markdown 编写的，展示了 MDxEditor 的强大渲染能力。--

** 表格内的挖空 **:
挖空功能完美集成在表格中，不破坏表格结构，且支持排序。

| 概念 | 定义 (点击查看) | 备注 |
| :--- | :--- | :--- |
| **HTML** | --超文本标记语言 (HyperText Markup Language)-- | 网页的基础结构 |
| **CSS** | --层叠样式表 (Cascading Style Sheets)-- | 用于样式设计 |
| **JS** | --JavaScript-- | 用于交互逻辑 |
`,
        mentionScope: ['*'], 
        aiEnabled: true
    },

    // --- Prompt Workspace ---
    {
        elementId: 'prompt-workspace',
        moduleName: 'prompts',
        type: 'standard',
        title: 'Prompt Library',
        createFileLabel: 'Prompt',
        defaultFileName: 'Welcome to Prompts.md',
        defaultExtension: '.md',
        defaultFileContent: `# Welcome to Your Prompt Library!

This is your personal space to create, manage, and reuse powerful prompts for Large Language Models (LLMs).

## What is a Prompt?

A prompt is a piece of text that you provide to an AI model to get a specific response. A well-crafted prompt can dramatically improve the quality of the output.

## How to Use This Space

*   **Create a New Prompt**: Click the '+' icon in the sidebar to create a new prompt file.
*   **Organize**: Use folders to group related prompts, such as 'Marketing', 'Coding', or 'Creative Writing'.
*   **Use Variables**: You can use placeholders like \`{{variable_name}}\` in your prompts, which you can replace later.

### Example Prompt

\`\`\`markdown
Translate the following English text to French:

"{{text_to_translate}}"
\`\`\`
`,
        aiEnabled: true
    },

    // --- Projects Workspace ---
    {
        elementId: 'project-workspace',
        moduleName: 'projects',
        type: 'standard',
        title: 'Projects',
        createFileLabel: 'Project',
        defaultFileName: 'Getting Started with Projects.md',
        defaultExtension: '.md',
        defaultFileContent: `# Manage Your Projects

This workspace helps you organize all your project-related documents, notes, and plans.

## Recommended Structure

We suggest creating a folder for each project. Inside each project folder, you could have files like:

*   **Goals.md**: High-level objectives and desired outcomes.
*   **Tasks.md**: A checklist of tasks to be completed.
*   **Meeting Notes**: A folder to store notes from project meetings.
*   **Research.md**: Links, summaries, and important findings.

Start by creating your first project folder using the folder icon in the sidebar!
`,
        aiEnabled: true
    },

    // --- Email Workspace ---
    {
        elementId: 'email-workspace',
        moduleName: 'emails',
        type: 'standard',
        title: 'Email Drafts',
        createFileLabel: 'Email',
        defaultFileName: 'How to Use Email Templates.md',
        defaultExtension: '.md',
        defaultFileContent: `# Email Drafts & Templates

Draft your important emails here before sending them. You can also create reusable templates to save time.

## Example Template: Follow-up Email

\`\`\`markdown
**Subject: Following up on our conversation**

Hi {{contact_name}},

It was great speaking with you earlier today about {{topic}}.

I've attached the [document/link] we discussed. Please let me know if you have any questions.

Best regards,

[Your Name]
\`\`\`
`,
        aiEnabled: true
    },

    // --- Private Workspace ---
    {
        elementId: 'private-workspace',
        moduleName: 'private',
        isProtected: true, 
        type: 'standard',
        title: 'Private Notes',
        createFileLabel: 'Note',
        defaultFileName: 'My First Note.md',
        defaultExtension: '.md',
        defaultFileContent: `# Your Private Notes

This is a secure and private space for your thoughts, ideas, and personal reminders.

Anything you write here is stored locally in your browser and is not sent to any server.

Feel free to jot down anything that comes to mind!
`,
        mentionScope: [], // 空数组表示仅当前模块
        aiEnabled: true
    },

    // --- LLM Workspace ---
    {
        elementId: 'llm-workspace',
        moduleName: FS_MODULE_CHAT,       // 数据存储在 /chats 模块
        type: 'chat',
        title: 'AI Sessions',
        createFileLabel: 'Chat',
        defaultFileName: 'New Chat.chat',
        defaultExtension: '.chat',
        defaultFileContent: JSON.stringify({ version: 1, sessions: [] }, null, 2),
        mentionScope: ['*'],       // 允许引用所有内容
        plugins: [],               // LLM 编辑器内部管理插件，此处留空
        aiEnabled: false
    },
];