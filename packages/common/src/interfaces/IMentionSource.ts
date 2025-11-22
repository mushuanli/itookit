/**
 * @file common/interfaces/IMentionSource.ts
 * @description Extends the generic provider interface with mention-specific features.
 */

import { IAutocompleteSource, Suggestion } from './IAutocompleteSource';

/** 
 * UPDATE: Replaced JSDoc @typedef with a native TypeScript interface for strong typing.
 * Defines the data structure for hover preview cards.
 */
export interface HoverPreviewData {
    title: string;
    contentHTML: string;
    icon?: string;
}

export type { Suggestion };

/**
 * @abstract
 * 提及功能数据源接口
 * 继承自自动完成源，增加了提及特有的功能（如点击处理、悬停预览、无头数据获取）。
 */
export abstract class IMentionSource extends IAutocompleteSource {
    /**
     * 数据源唯一标识，对应 URI 的 host 部分 (如 'file', 'user')
     */
    abstract readonly key: string;

    /**
     * 触发字符 (如 '@')
     */
    public triggerChar: string = '@';

    // --- 无头处理核心方法 ---
    async getDataForProcess(_targetURL: URL): Promise<any | null> {
        return null;
    }

    // --- UI 交互方法 ---
    async handleClick(targetURL: URL): Promise<void> {
        console.log(`[IMentionSource:${this.key}] Clicked:`, targetURL.toString());
    }

    /**
     * 获取悬停预览数据
     */
    async getHoverPreview(_uri: string): Promise<HoverPreviewData | null> {
        return null;
    }

    async getContentForTransclusion(_targetURL: URL): Promise<string | null> {
        return null;
    }
}
