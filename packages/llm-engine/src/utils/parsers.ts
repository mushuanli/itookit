// @file: llm-engine/utils/parsers.ts

/**
 * 专门针对 .chat 文件的解析逻辑
 * 放在 Engine 层以确保业务逻辑闭环，UI 层直接调用
 */
export const chatFileParser = (content: string): any => {
    try {
        const data = JSON.parse(content);
        return {
            summary: data.summary || '',
            searchableText: `${data.title} ${data.summary || ''} ${data.id}`.toLowerCase(),
            metadata: {
                ...data.settings,
                type: 'chat',
                updatedAt: data.updated_at,
                messageCount: Object.keys(data.branches || {}).length
            }
        };
    } catch (e) {
        console.warn('[chatFileParser] Parse failed:', e);
        // 返回基础元数据以防报错
        return { summary: 'Parse error', metadata: { type: 'chat' } };
    }
};
