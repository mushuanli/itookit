/**
 * @file apps/web-app/src/factories/editorFactory.ts
 */
import { createMDxEditor, EditorFactory } from '@itookit/mdxeditor';

/**
 * 标准编辑器工厂
 * 配置了常用的插件：工具栏、表格、列表、Markdown 扩展等
 */
export const defaultEditorFactory: EditorFactory = async (container, options) => {
    // 这里可以根据 options.readOnly 或其他条件进行动态配置

    const editor = await createMDxEditor(container, {
        ...options, // 传入 MemoryManager 注入的 options (如 nodeId, context functions)

        // 插件配置
        plugins: [
            // UI 基础
            'ui:toolbar',
            'ui:formatting',
            'core:titlebar', // 包含侧边栏切换按钮

            // 交互组件
            'interaction:table',
            'task-list',
            'codeblock-controls',

            // 语法扩展
            'folder', // 折叠代码
            'mathjax',
            'mermaid',
            'svg',

            // 自动补全 (Mention/Tag 需要 VFS 支持，MemoryManager 会自动注入 Provider)
            'autocomplete:tag',
            'autocomplete:mention'
        ],

        // 插件具体选项
        defaultPluginOptions: {
            'ui:toolbar': {
                // 可以在此自定义工具栏布局
            },
            ...(options.defaultPluginOptions || {})
        }
    });

    return editor;
};
