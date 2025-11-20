/**
 * @file apps/web-app/src/config/modules.ts
 */
export interface WorkspaceConfig {
    elementId: string;
    moduleName: string;
    title: string;
}

export const WORKSPACES: WorkspaceConfig[] = [
    {
        elementId: 'prompt-workspace',
        moduleName: 'prompts',
        title: 'Prompt Library'
    },
    {
        elementId: 'project-workspace',
        moduleName: 'projects',
        title: 'Projects'
    },
    {
        elementId: 'email-workspace',
        moduleName: 'emails',
        title: 'Email drafts'
    },
    {
        elementId: 'private-workspace',
        moduleName: 'private',
        title: 'Private Notes'
    },
    {
        elementId: 'llm-workspace',
        moduleName: 'agents',
        title: 'LLM Agents'
    }
    // Settings 通常不需要 VFS 文件管理，可以在 main.ts 单独处理
];
