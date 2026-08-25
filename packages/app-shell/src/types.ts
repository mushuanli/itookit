import type {NavigationRequest, ICommandBus, ILLMService} from '@itookit/common';
import type { FileCreationConfig, EditorFactory, EditorOptions, ContextMenuConfig } from '@itookit/ui-common';
import type { IStorageBackend, IVFSManager, MountOptions, IModuleFS } from '@itookit/vfs-core';
import type { ThemeMode } from './ThemeService';
import type { FileTypeDefinition, CustomEditorResolver, VFSUIOptions } from '@itookit/vfs-ui';
import type { KernelAdaptersRuntime, KernelAdaptersRuntimeOptions } from '@itookit/kernel-adapters';
import type { Kernel } from '@itookit/durable-kernel';
import type {
    DagPluginRegistry,
    IChatEngine,
    VFSAgentService,
    IAgentManagementService,
    IAgentConfigService,
    IPrivilegedCommandService,
} from '@itookit/llm-session';
import type { LLMUIEditors } from '@itookit/app-settings';

export interface AppKernelRuntime extends KernelAdaptersRuntime {
    kernel: Kernel;
    dagPlugins: DagPluginRegistry;
}

export interface AppKernelPlatform {
    skillSource?: KernelAdaptersRuntimeOptions['skillSource'];
    skillToolHandlerFactory?: KernelAdaptersRuntimeOptions['skillToolHandlerFactory'];
    configure?(kernel: AppKernelRuntime): void | Promise<void>;
}

export type WorkspaceType = 'standard' | 'settings' | 'agent' | 'chat' | 'skills' | 'flows';

export interface WorkspaceConfig {
    elementId: string;
    moduleName: string;
    /** URL hash segment, e.g. 'chat', 'files', 'agents' */
    slug: string;
    type?: WorkspaceType;
    title: string;
    supportedFileTypes: string[];
    syncEnabled: boolean;
    isProtected?: boolean;
    isSystem?: boolean;
    plugins?: string[];
    mentionScope?: string[];
    mentionAble?: boolean;
    aiEnabled?: boolean;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
    searchPlaceholder?: string;
    /**
     * 在文件树中显示文件扩展名（如 .md / .ts / .pdf）。
     * 外部文件系统挂载（home、mount）设为 true；内部模块保持 false（默认）。
     */
    showFileExtensions?: boolean;
    /** Instant file creation config — passed through to VFSUIShell */
    fileCreation?: FileCreationConfig;
}

export interface AdditionalMount {
    path: string;
    backend: IStorageBackend;
    options?: MountOptions;
}

// ── UI 装配契约 ──────────────────────────────────────────────────────────
//
// app-shell 不直接依赖 @itookit/llm-ui：编辑器工厂 / AI 右键菜单 / LLM 设置
// 编辑器均通过 AppOptions.ui 由 apps 入口注入。契约类型定义在 app-shell
// （装配层，已依赖全部所需类型），llm-ui 的实现靠结构类型在入口处兼容。

export interface ChatEditorDeps {
    chatEngine: IChatEngine;
    llmService?: ILLMService;
    commandBus?: ICommandBus;
    kernel?: Kernel;
    privilegedCommands?: IPrivilegedCommandService;
}

export interface FlowEditorDeps {
    commands: ICommandBus;
    /** Optional override for the run action (defaults to create-session + navigate). */
    onRunFlow?: (flowId: string, revision: number) => void;
    /** Global LLM connections available to bind flow-level connection slots to. */
    listConnections?: () => Promise<Array<{ id: string; name: string }>>;
    listAgents?: () => Promise<Array<{ id: string; name: string; description?: string }>>;
    listSystemPrompts?: () => Promise<Array<{ id: string; name: string; description?: string }>>;
    listTools?: () => Promise<Array<{ id: string; name: string; description?: string }>>;
    listSkills?: () => Promise<Array<{ id: string; name: string; description?: string }>>;
}

export interface AIContextMenuDeps {
    agentService: IAgentConfigService;
    engine: IModuleFS;
    filesOnly?: boolean;
}

/** Structural subset of a VFS node the AI context menu needs (mirrors llm-ui's NodeItem). */
export interface AIContextMenuNode {
    id: string;
    type: 'file' | 'directory';
    metadata: { title: string; custom: Record<string, unknown> };
}

export interface AppUI {
    createChatEditor(agentService: VFSAgentService, deps: ChatEditorDeps): EditorFactory;
    createAgentEditor(agentService: VFSAgentService): EditorFactory;
    createFlowEditor(deps: FlowEditorDeps): EditorFactory;
    createSkillEditor(agentService: IAgentManagementService): EditorFactory;
    createAIContextMenu<TNode extends AIContextMenuNode>(deps: AIContextMenuDeps): ContextMenuConfig<TNode>;
    llmUiEditors: LLMUIEditors;
}

export interface AppOptions {
    /** Primary storage backend (IndexedDB, LocalFS, InMemory, etc.) */
    backend: IStorageBackend;
    /** Extra backend mounts, e.g. tauri home dir at /module/home */
    additionalMounts?: AdditionalMount[];
    workspaces: WorkspaceConfig[];
    /** URL slug to navigate to on startup. Defaults to first workspace. */
    defaultSlug?: string;
    /** Extra slug → elementId aliases, e.g. { home: 'home-workspace' } */
    routeAliases?: Record<string, string>;
    /** Called during boot steps; use this to drive a loading overlay. */
    onProgress?: (msg: string) => void;
    /** LLM traffic logger (NoopLLMLogger for web, TauriLLMLogger for Tauri) */
    llmLogger?: import('@itookit/common').ILLMLogger;
    /** Runtime transport for the local Codex app-server (Node/Tauri only). */
    codexTransport?: import('@itookit/device-llm').CodexAppServerTransport;
    /** Platform capabilities implemented by the owning application. */
    kernelPlatform?: AppKernelPlatform;
    /** UI implementations (editor factories, AI menu, LLM settings editors) injected by the entry app. */
    ui: AppUI;
}

export interface AppHandle {
    navigate(slug: string, resourceId?: string): Promise<void>;
    /** Set the global UI theme and persist to etc:/ui/theme.json */
    setTheme(mode: ThemeMode): Promise<void>;
    /** Register a dynamically created workspace (e.g. a local mount tab). */
    addWorkspace(config: WorkspaceConfig): void;
    /** Unsubscribe all global event listeners and release resources. */
    destroy(): Promise<void>;
    vfs: IVFSManager;
}

// ── Workbench config ────────────────────────────────────────────────────

export interface WorkbenchConfig {
    /** VFS 侧边栏挂载容器（消费方负责创建 DOM） */
    sidebarContainer: HTMLElement;
    /** 编辑器挂载容器（消费方负责创建 DOM） */
    editorContainer: HTMLElement;
    /** Scope ID 用于多实例隔离 (localStorage key, modal ID 等) */
    scopeId?: string;
    /** VFS 实例 (与 moduleName 配合使用) */
    vfs?: IVFSManager;
    /** 自定义引擎实例 */
    customEngine?: IModuleFS;
    moduleName?: string;
    editorFactory?: EditorFactory;
    editorConfig?: Partial<EditorOptions> & {
        mentionScope?: string[];
    };
    onNavigate?: (request: NavigationRequest) => Promise<void>;
    onSessionChange?: (sessionId: string | null) => void;
    onSidebarToggle?: (collapsed: boolean) => void;
    uiOptions?: Partial<Omit<VFSUIOptions, 'defaultEditorFactory'>>;
    fileTypes?: FileTypeDefinition[];
    customEditorResolver?: CustomEditorResolver;
    showFileExtensions?: boolean;
    defaultContentConfig?: { fileName: string; content: string };
    createConfig?: { initialInputState?: { text?: string; agentId?: string } };
    aiConfig?: { enabled: boolean; activeRules?: string[] };
}
