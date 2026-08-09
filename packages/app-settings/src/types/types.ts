// @file app-settings/types.ts

// LLM 相关类型直接从 common 导入，避免对 device-llm / llm-runtime 的间接依赖
import type { LLMConnection, MCPServer } from '@itookit/common';

// 向后兼容重新导出
export type { LLMConnection };

export interface Tag {
    id: string;
    name: string;
    color: string;
    description?: string;
    count?: number;
}

export interface Contact {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    group?: string;
    notes?: string;
}

export interface SettingsState {
    connections: LLMConnection[];
    mcpServers: MCPServer[];
    tags: Tag[];
    contacts: Contact[];
}
