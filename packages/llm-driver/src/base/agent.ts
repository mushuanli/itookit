/**
 * @file llmdriver/base/agent.ts
 * @description 定义 Agent 的持久化存储结构（即 .agent 文件的内容标准）。
 * 这充当了存储层(App)和执行层(LLM-UI)之间的共享数据契约。
 */

import { LLMAgentConfig } from './config';

/**
 * Agent 的类型定义
 * - agent: 单一原子智能体 (对应 ExecutorType 'atomic')
 * - orchestrator: 编排器 (对应 ExecutorType 'composite')
 */
export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow' | 'orchestrator' ;// TODO: 'agent' | 'orchestrator';

/**
 * Agent 存储配置接口
 * 扩展基础 LLM 配置，包含工具服务引用等持久化字段
 */
export interface AgentStorageConfig extends LLMAgentConfig {
    /** 
     * 引用的 MCP 服务器 ID 列表 
     * 用于在运行时加载相应的工具集
     */
    mcpServers?: string[];
}

/**
 * 运行时接口定义 (Inputs/Outputs)
 * 用于 UI 生成表单、校验输入或在编排器中连线
 */
export interface AgentInterfaceDef {
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
}

/**
 * Agent 文件内容结构 (.agent JSON)
 * 这是 App 存储和 Settings Editor 编辑的直接对象，也是 LLM-UI 读取配置的标准格式。
 */
export interface IAgentDefinition {
    /** 唯一标识符 */
    id: string;
    
    /** 显示名称 */
    name: string;
    
    /** Agent 类型 */
    type: AgentType;
    
    /** 描述 */
    description?: string;
    
    /** 图标 (Emoji 或 URL) */
    icon?: string;
    
    /** 
     * 存储态核心配置
     * 包含引用 ID (connectionId, modelId) 而不是具体的连接对象 
     */
    config: AgentStorageConfig;
    
    /** 输入输出接口定义 */
    interface?: AgentInterfaceDef;
    
    /** VFS 元数据 (可选，通常由文件系统管理，但导出时可能包含) */
    tags?: string[];
    createdAt?: number;
    modifiedAt?: number;
}
