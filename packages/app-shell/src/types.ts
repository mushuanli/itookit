import type {NavigationRequest} from '@itookit/common';
import type { FileCreationConfig, EditorFactory, EditorOptions } from '@itookit/ui-common';
import type { IStorageBackend, IVFSManager, MountOptions, IModuleFS } from '@itookit/stdio';
import type { ThemeMode } from './ThemeService';
import type { FileTypeDefinition, CustomEditorResolver, VFSUIOptions } from '@itookit/vfs-ui';
import type { CoreutilsRuntime, CoreutilsRuntimeOptions } from '@itookit/coreutils';
import type { Harness } from '@itookit/harness';
import type { DagPluginRegistry } from '@itookit/llm-conversation';

export interface AppHarnessRuntime extends CoreutilsRuntime {
    kernel: Harness;
    dagPlugins: DagPluginRegistry;
}

export interface AppHarnessPlatform {
    skillSource?: CoreutilsRuntimeOptions['skillSource'];
    skillToolHandlerFactory?: CoreutilsRuntimeOptions['skillToolHandlerFactory'];
    configure?(harness: AppHarnessRuntime): void | Promise<void>;
}

export type WorkspaceType = 'standard' | 'settings' | 'agent' | 'chat' | 'skills';

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
    /** Platform capabilities implemented by the owning application. */
    harnessPlatform?: AppHarnessPlatform;
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
