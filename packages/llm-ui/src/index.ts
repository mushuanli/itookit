// @file: llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './LLMWorkspaceEditor';
import { 
    VFSAgentService, 
    ILLMSessionEngine, 
} from '@itookit/llm-engine';
import { EditorFactory, EditorOptions } from '@itookit/common';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';

/**
 * 创建 LLM 编辑器工厂
 * @param agentService 已初始化的 AgentService
 * 
 * @example 动态创建带初始状态的会话
 * ```ts
 * const factory = createLLMFactory(agentService);
 * const editor = await factory(container, {
 *     title: 'New Chat',
 *     sessionEngine: engine,
 *     // ✨ 支持外部指定初始输入状态
 *     initialInputState: {
 *         text: '请帮我分析这个问题...',
 *         agentId: 'my-custom-agent'
 *     }
 * });
 * ```
 */
export const createLLMFactory = (
    agentService: VFSAgentService
): EditorFactory => {
    
    return async (container: HTMLElement, options: EditorOptions) => {
        let effectiveNodeId = options.nodeId;
        
        // 类型转换，此时 sessionEngine 应该已经在 MemoryManager 中通过 Dependency Injection 注入
        const llmOptions = options as LLMEditorOptions;
        const engine = llmOptions.sessionEngine as ILLMSessionEngine;

        if (!engine) {
            console.error('[LLMFactory] Critical: sessionEngine missing in options. Make sure MemoryManager is injecting it correctly.');
        }

        let isNewSession = false;

        if (!effectiveNodeId && engine) {
            // 如果没有 nodeId，创建新文件
            const newNode = await engine.createFile(options.title || 'New Chat', null);
            effectiveNodeId = newNode.id;
            isNewSession = true;  // ✨ 标记为新会话
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        // 此时 sessionEngine 应该已经在 main.ts 中通过 initializeLLMEngine 准备好了
        // 我们不需要在这里再次调用初始化逻辑，直接使用

        const editorOptions: LLMEditorOptions = {
            ...llmOptions,
            agentService,
            nodeId: effectiveNodeId,
            sessionEngine: engine,
            isNewSession,  // ✨ 传递新会话标记
        };

        const editor = new LLMWorkspaceEditor(container, editorOptions);
        await editor.init(container, options.initialContent);

        console.log(`[LLMFactory] Editor created successfully, isNew: ${isNewSession}`);
        return editor;
    };
};

/**
 * 创建 Agent 配置编辑器工厂
 */
export const createAgentEditorFactory = (agentService: VFSAgentService): EditorFactory => {
    return async (container, options) => {
        const editor = new AgentConfigEditor(container, options, agentService);
        await editor.init(container, options.initialContent);
        return editor;
    };
};

// 导出类型和类
export { VFSAgentService };
export type { LLMEditorOptions };
