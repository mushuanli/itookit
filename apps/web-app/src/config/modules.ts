/**
 * @file apps/web-app/src/config/modules.ts
 */
export interface WorkspaceConfig {
    elementId: string;
    moduleName: string;
    title: string;
    defaultFileName?: string;
    defaultFileContent?: string;
}

export const WORKSPACES: WorkspaceConfig[] = [
    {
        elementId: 'prompt-workspace',
        moduleName: 'prompts',
        title: 'Prompt Library',
        defaultFileName: 'Welcome to Prompts.md',
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
`
    },
    {
        elementId: 'project-workspace',
        moduleName: 'projects',
        title: 'Projects',
        defaultFileName: 'Getting Started with Projects.md',
        defaultFileContent: `# Manage Your Projects

This workspace helps you organize all your project-related documents, notes, and plans.

## Recommended Structure

We suggest creating a folder for each project. Inside each project folder, you could have files like:

*   **Goals.md**: High-level objectives and desired outcomes.
*   **Tasks.md**: A checklist of tasks to be completed.
*   **Meeting Notes**: A folder to store notes from project meetings.
*   **Research.md**: Links, summaries, and important findings.

Start by creating your first project folder using the folder icon in the sidebar!
`
    },
    {
        elementId: 'email-workspace',
        moduleName: 'emails',
        title: 'Email Drafts',
        defaultFileName: 'How to Use Email Templates.md',
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
`
    },
    {
        elementId: 'private-workspace',
        moduleName: 'private',
        title: 'Private Notes',
        defaultFileName: 'My First Note.md',
        defaultFileContent: `# Your Private Notes

This is a secure and private space for your thoughts, ideas, and personal reminders.

Anything you write here is stored locally in your browser and is not sent to any server.

Feel free to jot down anything that comes to mind!
`
    },
    {
        elementId: 'llm-workspace',
        moduleName: 'agents',
        title: 'LLM Agents',
        defaultFileName: 'Defining an LLM Agent.md',
        defaultFileContent: `# How to Define an LLM Agent

An LLM Agent is a blueprint for an autonomous AI that can perform tasks. You can define its personality, tools, and goals here.

## Agent Structure (Example)

You can define an agent using a structured format like Markdown or JSON.

### Example Agent: Research Assistant

*   **Role**: A friendly and knowledgeable research assistant.
*   **Goal**: To find and summarize information on any given topic.
*   **Tools**:
    *   \`web_search\`: Can search the internet for information.
    *   \`document_reader\`: Can read and understand PDF or text documents.
*   **Constraints**:
    *   Must cite all sources.
    *   Should provide unbiased summaries.
`
    }
    // Settings 通常不需要 VFS 文件管理，可以在 main.ts 单独处理
];