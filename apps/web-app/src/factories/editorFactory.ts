/**
 * @file apps/web-app/src/factories/editorFactory.ts
 * @description Provides factory functions for creating editor instances.
 */
import { createMDxEditor } from '@itookit/mdxeditor';
import { EditorFactory } from '@itookit/common';

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
