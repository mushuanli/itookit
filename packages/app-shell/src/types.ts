import type { IStorageBackend, IVFSManager, MountOptions, FileCreationConfig } from '@itookit/common';

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
}

export interface AppHandle {
    navigate(slug: string, resourceId?: string): Promise<void>;
    /** Register a dynamically created workspace (e.g. a local mount tab). */
    addWorkspace(config: WorkspaceConfig): void;
    /** Unsubscribe all global event listeners and release resources. */
    destroy(): void;
    vfs: IVFSManager;
}
