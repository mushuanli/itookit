// @file: llm-harness/src/skills/correction-log.ts
// 修正日志：读取 AI 犯错日志并生成注入提示词。

/**
 * 读取修正日志文件内容。
 * Node.js 环境专用；浏览器环境返回空字符串。
 */
export async function readCorrectionLog(filePath: string): Promise<string> {
    try {
        const fs = await import('node:fs/promises');
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * 构建修正日志注入提示词片段。
 *
 * @param skillId  Skill 标识
 * @param logContent  日志文件内容（空则返回空字符串）
 */
export function buildCorrectionLogPrompt(skillId: string, logContent: string): string {
    const trimmed = logContent.trim();
    if (!trimmed) return '';
    return (
        `[Correction Log] Prior mistakes and corrected behavior for ${skillId}:\n` +
        trimmed +
        '\nApply these rules consistently.'
    );
}
