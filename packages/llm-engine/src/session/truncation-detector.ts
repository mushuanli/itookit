// @file: llm-engine/session/truncation-detector.ts

/**
 * 截断检测结果
 */
export interface TruncationResult {
    /** 是否被截断 */
    truncated: boolean;
    /** 置信度 */
    confidence: 'high' | 'medium' | 'low';
    /** 截断原因 */
    reason?: string;
}

/**
 * Markdown 截断检测器
 * 
 * 通过分析未封闭的 Markdown 结构判断 LLM 响应是否被截断。
 * 
 * 设计原则：
 * - 宁可漏检也不误检（false negative > false positive）
 * - 误检会导致多余的 API 调用和不自然的拼接
 * - finish_reason === 'length' 是最可靠的信号，结构检测作为补充
 *
 * 检测层次（置信度递减）：
 * 1. finish_reason（API 级，最可靠）
 * 2. 块级结构（代码块、数学块、HTML 块标签）
 * 3. 启发式（编号列表中断，仅超长内容）
 */
export class TruncationDetector {

    /**
     * 综合判断内容是否被截断
     * 
     * @param content - assistant 输出的完整内容
     * @param finishReason - API 返回的结束原因（最可靠信号）
     */
    detect(content: string, finishReason?: string): TruncationResult {
        // 空内容或极短内容 → 不续写
        if (!content || content.trim().length < 10) {
            return { truncated: false, confidence: 'high' };
        }

        // ── 1. API 级信号（最高优先级） ──

        if (finishReason === 'stop') {
            return { truncated: false, confidence: 'high' };
        }

        if (finishReason === 'length') {
            return {
                truncated: true,
                confidence: 'high',
                reason: 'finish_reason=length',
            };
        }

        // ── 2. Markdown 结构检测 ──

        const structuralCheck = this.checkStructure(content);
        if (structuralCheck.truncated) {
            return structuralCheck;
        }

        // 启发式检测（仅在无 finishReason 时使用）
        if (!finishReason) {
            return this.checkHeuristics(content);
        }

        return { truncated: false, confidence: 'low' };
    }

    // ============================================
    // 结构性检测
    // ============================================

    /**
     * 结构性检测：未封闭的 Markdown 块级元素
     *
     * 只检测**块级**结构，忽略内联元素（内联 ` 和 $ 误判率太高）。
     */
    private checkStructure(content: string): TruncationResult {
        // 1. 未关闭的代码块
        if (this.hasUnclosedCodeBlock(content)) {
            return {
                truncated: true,
                confidence: 'high',
                reason: 'unclosed_code_block',
            };
        }

        // 2. 未关闭的数学块 $$
        if (this.hasUnclosedMathBlock(content)) {
            return {
                truncated: true,
                confidence: 'high',
                reason: 'unclosed_math_block',
            };
        }

        // 3. 未关闭的 HTML 块级标签
        if (this.hasUnclosedBlockTags(content)) {
            return {
                truncated: true,
                confidence: 'medium',
                reason: 'unclosed_html_tag',
            };
        }

        return { truncated: false, confidence: 'low' };
    }

    /**
     * 检测未关闭的代码块
     *
     * 逐行扫描，只匹配独占一行的 ``` 围栏。
     * 忽略行内出现的 ```（如代码片段讲解），减少误判。
     */
    private hasUnclosedCodeBlock(content: string): boolean {
        const lines = content.split('\n');
        let open = false;

        for (const line of lines) {
            const trimmed = line.trim();
            // 开启围栏：```  或 ```lang
            // 关闭围栏：``` （可能带尾部空格）
            // 共同特征：整行 trim 后以 ``` 开头，且后续只有可选的语言标识
            if (/^```(\S*)$/.test(trimmed)) {
                open = !open;
            }
        }

        return open;
    }

    /**
     * 检测未关闭的数学块 $$
     *
     * 逐行扫描，只匹配独占一行的 $$。
     */
    private hasUnclosedMathBlock(content: string): boolean {
        const lines = content.split('\n');
        let open = false;

        for (const line of lines) {
            if (line.trim() === '$$') {
                open = !open;
            }
        }

        return open;
    }

    /**
     * 检测未关闭的 HTML 块级标签
     *
     * 只检测常见块级标签，忽略自闭合标签和内联标签。
     * 使用简单的计数策略：open > close → 未关闭。
     */
    private hasUnclosedBlockTags(content: string): boolean {
        const blockTags = ['div', 'table', 'thead', 'tbody', 'tr', 'details', 'summary', 'pre', 'blockquote', 'section', 'article'];

        for (const tag of blockTags) {
            const openPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
            const closePattern = new RegExp(`</${tag}\\s*>`, 'gi');

            const openCount = (content.match(openPattern) || []).length;
            const closeCount = (content.match(closePattern) || []).length;

            if (openCount > closeCount) {
                return true;
            }
        }

        return false;
    }

    // ============================================
    // 启发式检测
    // ============================================

    /**
     * 启发式检测：内容模式分析
     *
     * 这些信号单独可靠性不高，仅在无 finishReason 且内容较长时使用。
     * 故意保守：宁可漏检也不误检。
     */
    private checkHeuristics(content: string): TruncationResult {
        const trimmed = content.trimEnd();

        // 仅对长内容做启发式检测，短内容误判风险太高
        if (trimmed.length < 2000) {
            return { truncated: false, confidence: 'low' };
        }

        // 1. 有序列表中断检测
        const listCheck = this.checkNumberedListInterruption(trimmed);
        if (listCheck) {
            return listCheck;
        }

        return { truncated: false, confidence: 'low' };
    }

    /**
     * 检测有序列表是否在递增序列中突然中断
     *
     * 条件（全部满足才判定）：
     * - 内容 > 2000 字符
     * - 末尾是编号列表项
     * - 最后 3 个编号严格递增（如 5, 6, 7）
     * - 仍然只给 medium 置信度（highConfidenceOnly 模式下不会触发续写）
     */
    private checkNumberedListInterruption(content: string): TruncationResult | null {
        const lines = content.split('\n');
        const lastLine = lines[lines.length - 1]?.trim() || '';

        const numberedListPattern = /^(\d+)\.\s/;
        if (!numberedListPattern.test(lastLine)) {
            return null;
        }

        // 收集所有编号列表项的序号
        const allNums: number[] = [];
        for (const line of lines) {
            const match = line.trim().match(numberedListPattern);
            if (match) {
                allNums.push(parseInt(match[1], 10));
            }
        }

        if (allNums.length < 3) {
            return null;
        }

        // 检查最后 3 个编号是否严格连续递增
        const tail = allNums.slice(-3);
        if (tail[2] === tail[1] + 1 && tail[1] === tail[0] + 1) {
            return {
                truncated: true,
                confidence: 'medium',
                reason: 'numbered_list_interrupted',
            };
        }

        return null;
    }
}
