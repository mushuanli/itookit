/**
 * @file vfsCore/providers/PlainTextProvider.js
 * @fileoverview PlainTextProvider - 纯文本内容提供者
 */
import { ContentProvider } from './base/ContentProvider.js';

export class PlainTextProvider extends ContentProvider {
    constructor() {
        super('plain', {
            priority: 0, // 最低优先级，作为基础
            capabilities: ['read', 'write']
        });
    }
    
    /**
     * 读取纯文本内容
     */
    async read(vnode, options = {}) {
        // 纯文本不需要额外处理，内容由 VFS 从存储层读取
        return {
            content: null, // null 表示不修改内容
            metadata: {
                encoding: 'utf-8',
                lineCount: this._countLines(options.rawContent || '')
            }
        };
    }
    
    /**
     * 写入纯文本内容
     */
    async write(vnode, content, transaction) {
        // 纯文本不需要额外处理
        return {
            updatedContent: content,
            derivedData: {
                size: content.length,
                lineCount: this._countLines(content)
            }
        };
    }
    
    /**
     * 验证内容
     */
    async validate(vnode, content) {
        // 基础验证
        if (typeof content !== 'string') {
            return {
                valid: false,
                errors: ['Content must be a string']
            };
        }
        
        return { valid: true, errors: [] };
    }
    
    /**
     * 清理（纯文本无需清理）
     */
    async cleanup(vnode, transaction) {
        // No-op
    }
    
    /**
     * 统计行数
     */
    _countLines(content) {
        if (!content) return 0;
        return content.split('\n').length;
    }
}
