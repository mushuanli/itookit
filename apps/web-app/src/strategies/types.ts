// @file: app/strategies/types.ts
import { EditorFactory, ISessionEngine } from '@itookit/common';
import { EditorConfigEnhancer } from '@itookit/memory-manager';

/**
 * 工作区策略接口
 * 定义了创建一个特定类型工作区所需的所有组件行为
 */
export interface WorkspaceStrategy {
    /** 获取该工作区的基础编辑器工厂 */
    getFactory(): EditorFactory;

    /** 获取该工作区的后端引擎 (可选，若不提供则由 MemoryManager 自动创建 VFS 引擎) */
    getEngine?(moduleName: string): ISessionEngine;

    /** 
     * 获取配置增强器 
     * 用于向编辑器注入宿主能力 (HostContext)、提及范围 (Mention Scope) 或特定插件配置
     */
    getConfigEnhancer?(mentionScope?: string[]): EditorConfigEnhancer;
}
