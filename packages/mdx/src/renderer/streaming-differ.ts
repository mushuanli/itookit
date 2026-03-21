// @file: mdx/renderer/streaming-differ.ts

/**
 * 流式渲染差异计算器
 *
 * 将 Markdown 文本按顶层块分割，并与上次渲染的块列表对比，
 * 找到第一个发生变化的块索引。
 *
 * "顶层块"的定义：
 * - 由空行分隔的段落
 * - 代码块（``` 或 ~~~）作为整体
 * - 标题行
 * - 列表（连续的列表项）
 * - 引用块
 * - HTML 块
 * - 分隔线
 *
 * 设计原则：
 * - 纯函数式计算，无 DOM 依赖
 * - O(n) 分割 + O(min(old, new)) 对比
 * - 保守策略：有疑问时标记为"变化"，宁可多渲染不漏渲染
 */

export interface DiffResult {
    /** 第一个发生变化的块索引 */
    diffIndex: number;
    /** 是否有变化需要渲染 */
    hasChanges: boolean;
    /** 新增/变化的块数量 */
    changedBlockCount: number;
}

export class StreamingDiffer {
    private previousBlocks: string[] = [];

    /**
     * 将 Markdown 按顶层块分割
     *
     * 策略：
     * 1. 先处理 fenced code blocks（作为原子块）
     * 2. 再按空行分割其余内容
     * 3. 合并连续的列表项
     */
    splitBlocks(markdown: string): string[] {
        if (!markdown.trim()) return [];

        const blocks: string[] = [];
        const lines = markdown.split('\n');
        let current: string[] = [];
        let inCodeBlock = false;
        let codeFence = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trimStart();

            // 代码块边界检测
            if (!inCodeBlock) {
                const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
                if (fenceMatch) {
                    // 如果有累积的非代码内容，先保存
                    if (current.length > 0) {
                        const block = current.join('\n').trim();
                        if (block) blocks.push(block);
                        current = [];
                    }
                    inCodeBlock = true;
                    codeFence = fenceMatch[1][0].repeat(fenceMatch[1].length);
                    current.push(line);
                    continue;
                }
            } else {
                current.push(line);
                // 检查代码块结束
                if (trimmed.startsWith(codeFence) && trimmed.slice(codeFence.length).trim() === '') {
                    inCodeBlock = false;
                    const block = current.join('\n').trim();
                    if (block) blocks.push(block);
                    current = [];
                    codeFence = '';
                }
                continue;
            }

            // 非代码块：按空行分割
            if (line.trim() === '' && !inCodeBlock) {
                if (current.length > 0) {
                    const block = current.join('\n').trim();
                    if (block) blocks.push(block);
                    current = [];
                }
            } else {
                current.push(line);
            }
        }

        // 处理未关闭的代码块或剩余内容
        if (current.length > 0) {
            const block = current.join('\n').trim();
            if (block) blocks.push(block);
        }

        return blocks;
    }

    /**
     * 对比新旧块列表，返回第一个变化的索引
     *
     * 保守策略：
     * - 块数量变化 → 从最小长度处开始 diff
     * - 内容变化 → 从第一个不同的块开始
     * - 最后一个块总是标记为"可能变化"（正在输入中）
     */
    diff(newBlocks: string[]): DiffResult {
        const oldBlocks = this.previousBlocks;

        if (oldBlocks.length === 0) {
            return {
                diffIndex: 0,
                hasChanges: newBlocks.length > 0,
                changedBlockCount: newBlocks.length,
            };
        }

        // 找到第一个不同的块
        const minLen = Math.min(oldBlocks.length, newBlocks.length);
        let diffIndex = minLen; // 默认：所有公共块都相同

        for (let i = 0; i < minLen; i++) {
            if (oldBlocks[i] !== newBlocks[i]) {
                diffIndex = i;
                break;
            }
        }

        // 保守策略：新增块时，最后一个旧块可能被追加了内容
        if (diffIndex === minLen && newBlocks.length > oldBlocks.length) {
            diffIndex = Math.max(0, oldBlocks.length - 1);
        }

        // 如果没有变化
        if (diffIndex >= newBlocks.length && newBlocks.length === oldBlocks.length) {
            return { diffIndex: newBlocks.length, hasChanges: false, changedBlockCount: 0 };
        }

        return {
            diffIndex,
            hasChanges: true,
            changedBlockCount: newBlocks.length - diffIndex,
        };
    }

    /**
     * 提交当前块列表为"已渲染"状态
     */
    commit(blocks: string[]): void {
        this.previousBlocks = [...blocks];
    }

    /**
     * 重置状态
     */
    reset(): void {
        this.previousBlocks = [];
    }

    /**
     * 获取已渲染的块数量（调试用）
     */
    getRenderedBlockCount(): number {
        return this.previousBlocks.length;
    }
}
