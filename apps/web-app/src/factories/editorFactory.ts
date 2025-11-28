/**
 * @file apps/web-app/src/factories/editorFactory.ts
 */
import { createMDxEditor } from '@itookit/mdxeditor';
import { EditorFactory, IEditor } from '@itookit/common';
import { AgentConfigEditor } from '../workspace/settings/editors/AgentConfigEditor';
import { SettingsService } from '../workspace/settings/services/SettingsService';

// 1. 标准 MDxEditor Factory
const createStandardConfig = (managerOptions: any) => {
    return {
        ...managerOptions,
        plugins: ['core:titlebar', ...(managerOptions.plugins || [])],
        initialMode: 'render',
        defaultPluginOptions: {
            ...managerOptions.defaultPluginOptions,
            'core:titlebar': {
                title: managerOptions.title || 'Untitled',
                enableToggleEditMode: true,
                ...(managerOptions.defaultPluginOptions?.['core:titlebar'] || {})
            }
        }
    };
};

export const defaultEditorFactory: EditorFactory = async (container, options) => {
    const config = createStandardConfig(options);
    return await createMDxEditor(container, config);
};

/**
 * 智能编辑器工厂 - 用于 Agent Workspace
 * 根据文件类型选择合适的编辑器
 */
export const createSmartEditorFactory = (settingsService: SettingsService): EditorFactory => {
    return async (container: HTMLElement, options: any): Promise<IEditor> => {
        const { fileName } = options;

        // .agent 文件使用专用配置编辑器
        if (fileName && fileName.endsWith('.agent')) {
            const editor = new AgentConfigEditor(container, options, settingsService);
            await editor.init(container, options.initialContent);
            return editor;
        }

        // 其他文件回退到 Markdown 编辑器
        return defaultEditorFactory(container, options);
    };
};
