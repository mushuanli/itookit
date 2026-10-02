// @mdx/core/types.ts
/**
 * 核心类型定义
 * 
 * 作用：
 * 1. Own the editor contracts independently of host packages
 * 2. 定义 MDx 内部的核心接口
 * 3. 插件开发者只需导入此文件
 */

import type { AssetProvider } from '../editor/contracts';

import type { Extension } from '@codemirror/state';
import type { MarkedExtension } from 'marked';
import type { PluginManager } from './plugin-manager';

/**
 * 作用域持久化存储接口
 */
export interface ScopedPersistenceStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    updateDocumentPath?(path: string): void;
    destroy?(): void;
}

/**
 * 工具栏按钮配置 - 联合类型
 */
export type ToolbarButtonConfig =
    | {
        id: string;
        type?: 'button';
        title?: string;
        icon: string | HTMLElement;
        command?: string;
        onClick?: (context: any) => void | Promise<void>;
        location?: 'main' | 'mode-switcher';
    }
    | {
        id: string;
        type: 'separator';
        location?: 'main' | 'mode-switcher';
    };

/**
 * 标题栏按钮配置
 */
export interface TitleBarButtonConfig {
    id: string;
    title?: string;
    icon: string | HTMLElement;
    command?: string;
    onClick?: (context: any) => void | Promise<void>;
    location?: 'left' | 'right';
}

/**
 * 插件上下文接口
 */
export interface PluginContext {
    readonly pluginManager: PluginManager;

    // 语法扩展
    registerSyntaxExtension(ext: MarkedExtension): void;
    registerCodeMirrorExtension?(extension: Extension | Extension[]): void;

    // 生命周期钩子
    on(hook: string, callback: Function): () => void;

    // 依赖注入
    provide(key: string | symbol, service: any): void;
    inject(key: string | symbol): any;

    // 事件总线
    emit(eventName: string, payload: any): void;
    listen(eventName: string, callback: Function): () => void;

    // 持久化存储
    getScopedStore(): ScopedPersistenceStore;

    // Host capabilities
    notify(message: string, level: 'info' | 'success' | 'error'): void;
    getAssets(): AssetProvider | undefined;
    getDocumentPath(): string | undefined;

    // 编辑器交互（仅 MDxEditor 上下文可用）
    registerCommand?(name: string, fn: Function): void;
    registerToolbarButton?(config: ToolbarButtonConfig): void;
    registerTitleBarButton?(config: TitleBarButtonConfig): void;
    findAndSelectText?(text: string): void;
    switchToMode?(mode: 'edit' | 'render'): void;

    /** @internal 清理函数 */
    _cleanup?(): void;
}

/**
 * 插件接口
 */
export interface MDxPlugin {
    name: string;
    install(context: PluginContext): void;
    destroy?(): void;
}
