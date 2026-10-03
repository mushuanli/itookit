import { AgentConfigEditor, SkillSettingsEditor } from '@itookit/llm-settings-ui';
import type { IAgentManagementService } from '@itookit/kernel-adapters/contracts';
import type { EditorFactory } from '@itookit/ui-common';

export { ConnectionSettingsEditor, ProviderSettingsEditor, MCPSettingsEditor,
    SkillSettingsEditor, CostEditor, SystemPromptSettingsEditor } from '@itookit/llm-settings-ui';

export function createSkillsEditorFactory(agentService: IAgentManagementService): EditorFactory {
    return async (container, options) => {
        const editor = SkillSettingsEditor.createFormOnly(container, agentService, options);
        await editor.init(container, options.initialContent ?? '');
        return editor;
    };
}

export function createAgentEditorFactory(agentService: IAgentManagementService): EditorFactory {
    return async (container, options) => {
        const editor = new AgentConfigEditor(container, options, agentService);
        await editor.init(container, options.initialContent);
        return editor;
    };
}
