import { normalizeEditorOptions } from '@itookit/ui-common';
// @file: llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './shell/LLMWorkspaceEditor';
import {
    VFSAgentService,
    ISessionRepository,
} from '@itookit/llm-session';
import { IEditor } from '@itookit/ui-common';
import type { ILLMService, ICommandBus } from '@itookit/common';
import { EditorFactory, EditorOptions } from '@itookit/ui-common';
import type { Kernel } from '@itookit/durable-kernel';
import { AgentConfigEditor } from '@itookit/llm-settings-ui';

export type {
    IPrivilegedCommandService,
    PlanCommandRequest,
    ExecCommandRequest,
} from './domain/ports/IPrivilegedCommandService';

export { ConnectionSettingsEditor } from '@itookit/llm-settings-ui';
export { ProviderSettingsEditor } from '@itookit/llm-settings-ui';
export { MCPSettingsEditor } from '@itookit/llm-settings-ui';
export { SkillSettingsEditor } from '@itookit/llm-settings-ui';
export { CostEditor } from '@itookit/llm-settings-ui';
export { SystemPromptSettingsEditor } from '@itookit/llm-settings-ui';
export { DagWorkbench } from './components/DagWorkbench';
export type { DagWorkbenchOptions } from './components/DagWorkbench';
export { FlowsEditor, createFlowsEditorFactory } from './components/FlowsEditor';
export type { FlowsEditorDeps } from './components/FlowsEditor';

import type { PromptHistoryService } from '@itookit/llm-session';
import type { IAgentManagementService } from '@itookit/common';
import { SkillSettingsEditor } from '@itookit/llm-settings-ui';

/**
 * EditorFactory for the Skills workspace.
 *
 * VFSUIShell calls factory(container, options) when a skill node is selected.
 * options.target = entity skill ID; options.initialContent = skill name (for summary display).
 * The factory must call editor.init() — editor-connector does not do it automatically.
 */
export function createSkillsEditorFactory(agentService: IAgentManagementService): EditorFactory {
    return async (container: HTMLElement, options: EditorOptions = {}): Promise<import('@itookit/ui-common').IEditor> => {
        // createFormOnly already sets selectedId from options.target (the skill ID).
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
 * const factory = createLLMFactory(agentService, { sessionRepository });
 * const editor = await factory(container, {
 *     title: 'New Chat',
 *     fs: chatModuleFS
 * });
 * ```
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
    deps: {
        sessionRepository: ISessionRepository;
        llmService?: ILLMService;
        commandBus?: ICommandBus;
        kernel?: Kernel;
        privilegedCommands?: import('./domain/ports/IPrivilegedCommandService').IPrivilegedCommandService;
        sessionSkills?: import('@itookit/common').SessionSkillControls;
        onLoadMetrics?: LLMEditorOptions['onLoadMetrics'];
    },
): EditorFactory => {

    // 跟踪进行中的创建，按 sessionId 去重
    // 防止外部框架在短时间内对同一 sessionId 重复调用 factory
    const pendingByContainer = new WeakMap<HTMLElement, Map<string, Promise<IEditor>>>();

    return async (container: HTMLElement, options: EditorOptions) => {
        options = normalizeEditorOptions(options);
        let pendingCreations = pendingByContainer.get(container);
        if (!pendingCreations) { pendingCreations = new Map(); pendingByContainer.set(container, pendingCreations); }
        if (options.target?.kind !== 'session') throw new Error('Chat editor requires a Session target');
        const sessionId = options.target.sessionId;
        const engine = deps.sessionRepository;
        await engine.getManifest(sessionId);
        const isNewSession = false;

        // 去重：如果同一个 sessionId 正在创建中，等待并复用
        if (sessionId && pendingCreations.has(sessionId)) {
            try {
                return await pendingCreations.get(sessionId)!;
            } catch {
                // 前一次创建失败了，继续创建新的
                pendingCreations.delete(sessionId);
            }
        }

        const editorOptions: LLMEditorOptions = {
            ...options,
            agentService,
            sessionId,
            sessionRepository: engine,
            isNewSession,
            llmService: deps.llmService,
            commandBus: deps.commandBus,
            kernel: deps.kernel,
            privilegedCommands: deps.privilegedCommands,
            sessionSkills: deps.sessionSkills,
            onLoadMetrics: deps.onLoadMetrics,
        };

        // 将创建过程包装为 Promise，注册到 pendingCreations
        const createPromise = (async () => {
            try {
                const editor = new LLMWorkspaceEditor(container, editorOptions);
                await editor.init(container, options.initialContent);
                return editor;
            } catch (e) {
                console.error(`[LLMFactory] Editor creation failed for ${sessionId}:`, e);
                throw e;
            } finally {
                // 无论成功失败，都清理 pending 记录
                if (sessionId) {
                    pendingCreations.delete(sessionId);
                }
            }
        })();

        if (sessionId) {
            pendingCreations.set(sessionId, createPromise);
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

export { createFlowContextMenuConfig } from './flows/context-menu';
export { FlowLauncher, type FlowRunOptions } from './flows/run-flow';
export { installFlowLibrary, restoreFlowLibrary, builtinFlowLibrary } from './flows/library';
