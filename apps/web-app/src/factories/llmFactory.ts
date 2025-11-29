// apps/web-app/src/factories/llmFactory.ts

import { EditorFactory } from '@itookit/common';
import { LLMWorkspaceEditor } from '@itookit/llm-ui';
import { SettingsService } from '../workspace/settings/services/SettingsService';

export const createLLMFactory = (settingsService: SettingsService): EditorFactory => {
    return async (container, options) => {
        // 创建编辑器实例
        const editor = new LLMWorkspaceEditor(container, options, settingsService);
        
        // 执行初始化
        await editor.init(container, options.initialContent);
        
        return editor;
    };
};
