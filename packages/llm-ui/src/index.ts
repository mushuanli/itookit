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

        if (!effectiveNodeId && engine) {
            // 如果没有 nodeId，创建新文件
            const newNode = await engine.createFile(options.title || 'New Chat', null);
            effectiveNodeId = newNode.id;
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        // 此时 sessionEngine 应该已经在 main.ts 中通过 initializeLLMEngine 准备好了
        // 我们不需要在这里再次调用初始化逻辑，直接使用

        const editorOptions: LLMEditorOptions = {
            ...llmOptions,
            agentService,
            nodeId: effectiveNodeId,
            // 确保 engine 存在 (虽然 options 中已有，显式赋值更清晰)
            sessionEngine: engine 
        };

        const editor = new LLMWorkspaceEditor(container, editorOptions);
        await editor.init(container, options.initialContent);

        console.log(`[LLMFactory] Editor created successfully`);
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
