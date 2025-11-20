/**
 * @file apps/web-app/src/factories/editorFactory.ts
 */
import { createMDxEditor } from '@itookit/mdxeditor';

// 1. 定义 Factory 类型 (解决 TS7006 和 TS2305)
// MemoryManager 会传入 container 和一个包含 nodeId, initialContent 等信息的 options 对象
export type EditorFactory = (
    container: HTMLElement, 
    options: any // 或者定义具体的 interface { nodeId: string; initialContent?: string; ... }
) => Promise<any>;

/**
 * 2. 配置合并辅助函数 (参考 Demo 模式)
 * 作用：将 MemoryManager 传入的上下文 options 与我们定义的默认 plugins 进行智能合并
 */
const createStandardConfig = (managerOptions: any, customConfig: any = {}) => {
    // 基础插件列表
    const basePlugins = [
        'ui:toolbar',
        'ui:formatting',
        'core:titlebar',
        'interaction:table',
        'task-list',
        'codeblock-controls',
        'folder',
        'mathjax',
        'mermaid',
        'autocomplete:tag',
        'autocomplete:mention'
    ];

    // 合并插件列表 (去重可根据需要添加)
    const finalPlugins = [...basePlugins, ...(customConfig.plugins || [])];

    return {
        // A. 必须透传 MemoryManager 的 options (nodeId, context functions, initialContent)
        ...managerOptions,

        // B. 插件列表
        plugins: finalPlugins,
        initialMode: 'render',
        // C. 深度合并 defaultPluginOptions
        defaultPluginOptions: {
            ...managerOptions.defaultPluginOptions, // 先展开外部传入的

            // 针对特定插件做合并 (确保默认配置不被完全覆盖)
            'core:titlebar': {
                // 默认行为
                title: managerOptions.title || 'Untitled',
                enableToggleEditMode: true,
                // 允许外部覆盖默认行为
                ...(managerOptions.defaultPluginOptions?.['core:titlebar'] || {}),
                // 允许 customConfig 覆盖一切
                ...(customConfig.titleBar || {})
            },
            
            // 其他插件配置合并...
            'ui:toolbar': {
                 // 这里定义你的默认工具栏布局
                 ...(managerOptions.defaultPluginOptions?.['ui:toolbar'] || {}),
                 ...(customConfig.toolbar || {})
            }
        }
    };
};

/**
 * 3. 标准编辑器工厂实现
 */
export const defaultEditorFactory: EditorFactory = async (container, options) => {
    // 这里可以根据业务逻辑区分配置
    // 例如：如果 options.readOnly === true，可以传入不同的 customConfig

    const config = createStandardConfig(options, {
        // 在这里可以传入当前 App 特有的配置
        // 比如特定的 TaskList 样式选择器
        taskList: { checkboxSelector: '.my-todo-checkbox' } 
    });

    const editor = await createMDxEditor(container, config);

    return editor;
};
