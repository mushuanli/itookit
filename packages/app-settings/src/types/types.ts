// @file app-settings/types.ts

// 从 common 导入类型
import type { 
    LLMConnection as CommonLLMConnection,
} from '@itookit/llm-driver';

import { MCPServer} from '@itookit/llm-engine';

// 重新导出 LLMConnection，保持向后兼容
export type LLMConnection = CommonLLMConnection;


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
