// @file: llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './shell/LLMWorkspaceEditor';
import {
    VFSAgentService,
    ILLMSessionEngine,
} from '@itookit/llm-engine';
import { EditorFactory, EditorOptions } from '@itookit/common';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';
export { SkillSettingsEditor } from './editors/SkillSettingsEditor';

import type { PromptHistoryService } from '@itookit/llm-engine';

export interface LLMFactoryOptions {
    agentService: VFSAgentService;
    promptHistory?: PromptHistoryService;
}

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
 *     initialInputState: {
 *         text: '请帮我分析这个问题...',
 *         agentId: 'my-custom-agent'
 *     }
 * });
 * ```
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
): EditorFactory => {

    // ✅ 跟踪进行中的创建，按 nodeId 去重
    // 防止外部框架在短时间内对同一 nodeId 重复调用 factory
    const pendingCreations = new Map<string, Promise<any>>();

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
            isNewSession = true;
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        // ✅ 去重：如果同一个 nodeId 正在创建中，等待并复用
        if (effectiveNodeId && pendingCreations.has(effectiveNodeId)) {
            console.warn(`[LLMFactory] Duplicate creation for ${effectiveNodeId}, reusing pending instance`);
            try {
                return await pendingCreations.get(effectiveNodeId)!;
            } catch {
                // 前一次创建失败了，继续创建新的
                pendingCreations.delete(effectiveNodeId);
            }
        }

        const editorOptions: LLMEditorOptions = {
            ...llmOptions,
            agentService,
            nodeId: effectiveNodeId,
            sessionEngine: engine,
            isNewSession,
        };

        // ✅ 将创建过程包装为 Promise，注册到 pendingCreations
        const createPromise = (async () => {
            try {
                const editor = new LLMWorkspaceEditor(container, editorOptions);
                await editor.init(container, options.initialContent);

                console.log(`[LLMFactory] Editor created successfully, isNew: ${isNewSession}`);
                return editor;
            } catch (e) {
                console.error(`[LLMFactory] Editor creation failed for ${effectiveNodeId}:`, e);
                throw e;
            } finally {
                // ✅ 无论成功失败，都清理 pending 记录
                if (effectiveNodeId) {
                    pendingCreations.delete(effectiveNodeId);
                }
            }
        })();

        if (effectiveNodeId) {
            pendingCreations.set(effectiveNodeId, createPromise);
        }

        return createPromise;
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

// AI 右键菜单扩展
export { createAIContextMenuConfig } from './context-menu/AIContextMenu';
export type { AIContextMenuOptions } from './context-menu/AIContextMenu';
