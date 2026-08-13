// @file: llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './shell/LLMWorkspaceEditor';
import {
    VFSAgentService,
    IChatEngine,
} from '@itookit/llm-conversation';
import {formatDefaultFileTitle} from '@itookit/common';
import { IEditor } from '@itookit/ui-common';
import type { ILLMService, ICommandBus } from '@itookit/common';
import { EditorFactory, EditorOptions } from '@itookit/ui-common';
import type { Harness } from '@itookit/harness';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export type {
    IPrivilegedCommandService,
    PlanCommandRequest,
    ExecCommandRequest,
} from './domain/ports/IPrivilegedCommandService';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { ProviderSettingsEditor } from './editors/ProviderSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';
export { SkillSettingsEditor } from './editors/SkillSettingsEditor';
export { CostEditor } from './editors/CostEditor';
export { DagWorkbench } from './components/DagWorkbench';
export type { DagWorkbenchOptions } from './components/DagWorkbench';

import type { PromptHistoryService } from '@itookit/llm-conversation';
import type { IAgentManagementService } from '@itookit/common';
import { SkillSettingsEditor } from './editors/SkillSettingsEditor';

/**
 * EditorFactory for the Skills workspace.
 *
 * VFSUIShell calls factory(container, options) when a skill node is selected.
 * options.nodeId = skill ID; options.initialContent = skill name (for summary display).
 * The factory must call editor.init() — editor-connector does not do it automatically.
 */
export function createSkillsEditorFactory(agentService: IAgentManagementService): EditorFactory {
    return async (container: HTMLElement, options: EditorOptions = {}): Promise<import('@itookit/ui-common').IEditor> => {
        // createFormOnly already sets selectedId = options.nodeId (the skill ID).
        const editor = SkillSettingsEditor.createFormOnly(container, agentService, options);
        // The factory is responsible for calling init(). Pass initialContent as fallback.
        await editor.init(container, options.initialContent ?? '');
        return editor;
    };
}

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
 * const factory = createLLMFactory(agentService, { chatEngine });
 * const editor = await factory(container, {
 *     title: 'New Chat',
 *     moduleFS: chatModuleFS
 * });
 * ```
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
    deps: {
        chatEngine: IChatEngine;
        llmService?: ILLMService;
        commandBus?: ICommandBus;
        harness?: Harness;
        privilegedCommands?: import('./domain/ports/IPrivilegedCommandService').IPrivilegedCommandService;
    },
): EditorFactory => {

    // ✅ 跟踪进行中的创建，按 nodeId 去重
    // 防止外部框架在短时间内对同一 nodeId 重复调用 factory
    const pendingCreations = new Map<string, Promise<IEditor>>();

    return async (container: HTMLElement, options: EditorOptions) => {
        let effectiveNodeId = options.nodeId;
        const engine = deps.chatEngine;

        let isNewSession = false;

        if (!effectiveNodeId && engine) {
            // 如果没有 nodeId，创建新文件
            const newNode = await engine.createFile(options.title || formatDefaultFileTitle(), null);
            effectiveNodeId = newNode.path;
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
            ...options,
            agentService,
            nodeId: effectiveNodeId,
            chatEngine: engine,
            isNewSession,
            llmService: deps.llmService,
            commandBus: deps.commandBus,
            harness: deps.harness,
            privilegedCommands: deps.privilegedCommands,
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
