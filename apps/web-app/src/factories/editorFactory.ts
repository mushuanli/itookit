/**
 * @file apps/web-app/src/factories/editorFactory.ts
 * @description Provides factory functions for creating editor instances.
 */
import { createMDxEditor } from '@itookit/mdxeditor';
import { EditorFactory, IEditor } from '@itookit/common';
import { AgentConfigEditor } from '../workspace/settings/editors/AgentConfigEditor';
import { SettingsService } from '../workspace/settings/services/SettingsService';

/**
 * 1. 标准 Markdown 编辑器工厂
 * 封装了 createMDxEditor，注入了默认的插件配置。
 */
export const defaultEditorFactory: EditorFactory = async (container, options) => {
    const config = {
        ...options,
        // 确保核心 UI 插件被加载
        plugins: ['core:titlebar', ...(options.plugins || [])],
        initialMode: 'render' as const,
        defaultPluginOptions: {
            ...options.defaultPluginOptions,
            'core:titlebar': {
                title: options.title || 'Untitled',
                enableToggleEditMode: true,
                ...(options.defaultPluginOptions?.['core:titlebar'] || {})
            }
        }
    };
    return await createMDxEditor(container, config);
};

/**
 * 2. Agent 配置编辑器工厂生成器
 * 这是一个高阶函数，因为它需要注入单例的 SettingsService。
 * 返回的函数符合标准的 EditorFactory 签名。
 */
export const createAgentEditorFactory = (settingsService: SettingsService): EditorFactory => {
    return async (container: HTMLElement, options: any): Promise<IEditor> => {
        // 创建专用编辑器实例
        const editor = new AgentConfigEditor(container, options, settingsService);
        // 初始化
        await editor.init(container, options.initialContent);
        return editor;
    };
};
