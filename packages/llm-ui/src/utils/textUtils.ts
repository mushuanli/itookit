// @file: llm-ui/utils/textUtils.ts

/**
 * 纯函数文本工具集
 * 消除 SessionRenderer、FloatingNavPanel 中的重复代码
 */

/**
 * 将 Markdown 内容转为预览文本
 */
export function getPreviewText(content: string, maxLen: number = 60): string {
    if (!content) return '';
    const plain = content
        .replace(/[\r\n]+/g, ' ')
        .replace(/[*#`_~[\]()]/g, '')
        .trim();
    return plain.length > maxLen ? plain.substring(0, maxLen) + '...' : plain;
}

/**
 * 递归提取执行树的输出内容
 */
export function extractExecutionOutput(node: any): string {
    let output = node.data?.output || '';
    for (const child of node.children || []) {
        const childOutput = extractExecutionOutput(child);
        if (childOutput) output += '\n\n' + childOutput;
    }
    return output.trim();
}
