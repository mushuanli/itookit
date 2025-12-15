/**
 * @file llmdriver/utils/input.ts
 * @description 输入处理与清洗工具
 */

import { ChatMessage } from '../types';

/**
 * 安全地将任意输入转换为字符串
 * 用于处理 AgentExecutor 的 input 参数
 */
export function safeStringify(input: unknown): string {
    if (typeof input === 'string') {
        return input;
    }
    if (input === null || input === undefined) {
        return '';
    }
    if (typeof input === 'object') {
        try {
            return JSON.stringify(input);
        } catch {
            return String(input);
        }
    }
    return String(input);
}

/**
 * 验证并清洗历史消息
 * 确保传给 Driver 的 history 符合 ChatMessage 结构
 */
export function validateMessageHistory(history: unknown): ChatMessage[] {
    if (!Array.isArray(history)) {
        return [];
    }
    
    // 验证每个消息的结构
    return history.filter((msg): msg is ChatMessage => {
        return (
            msg !== null &&
            typeof msg === 'object' &&
            typeof msg.role === 'string' &&
            ['system', 'user', 'assistant', 'tool'].includes(msg.role) &&
            (typeof msg.content === 'string' || Array.isArray(msg.content))
        );
    });
}
