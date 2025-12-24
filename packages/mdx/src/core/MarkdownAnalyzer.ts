/**
 * @file core/maintenance/analysis/MarkdownAnalyzer.ts
 */
import { IDocumentAnalyzer, DocumentInfo, ReferenceExtractionResult,AnalysisContext } from '@itookit/common';

export class MarkdownAnalyzer implements IDocumentAnalyzer {
    readonly id = 'markdown-analyzer';

    // 可配置的支持列表
    private supportedExtensions = new Set(['.md', '.markdown', '.mdx', '.txt']);
    // 假设 markdown 都是 text/markdown 或 text/plain
    private supportedMimeTypes = new Set(['text/markdown', 'text/plain']);

    constructor(extensions: string[] = []) {
        if (extensions.length > 0) {
            this.supportedExtensions = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
        }
    }

    supports(doc: DocumentInfo): boolean {
        // 1. 优先检查扩展名
        const extIndex = doc.filename.lastIndexOf('.');
        if (extIndex !== -1) {
            const ext = doc.filename.substring(extIndex).toLowerCase();
            if (this.supportedExtensions.has(ext)) return true;
        }
        // 2. 其次检查 MIME (如果提供)
        if (doc.mimeType && this.supportedMimeTypes.has(doc.mimeType)) return true;

        return false;
    }

    async analyze(content: string | ArrayBuffer, context: AnalysisContext): Promise<ReferenceExtractionResult> {
        const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
        const refs = new Set<string>();

        // 策略 1: 匹配 @asset/filename 语法 (MDxEditor 标准)
        // 优化正则：支持带空格的文件名，通常 Markdown 链接不支持空格除非 URL 编码，但 @asset 可能是内部语法
        // 这里假设 @asset/ 后紧跟非空字符直到空白或括号
        const assetRegex = /@asset\/([^\s)"]+)/g;
        let match;
        while ((match = assetRegex.exec(text)) !== null) {
            refs.add(match[1]); // 提取 filename
        }

        // 策略 2: 匹配相对伴生目录 ](.filename/asset)
        // 假设 context.filePath 是 /module/path/to/doc.md
        const baseName = context.filePath.split('/').pop()!;
        const sidecarDir = `.${baseName}`;
        
        // 正则转义: .name -> \.name
        const escapedDir = sidecarDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // 匹配 Markdown 链接: ]( .doc.md / image.png )
        // 注意：URL 可能是编码过的
        const relativeRegex = new RegExp(`\\]\\(\\s*${escapedDir}\\/([^)\\s]+)`, 'g');
        
        while ((match = relativeRegex.exec(text)) !== null) {
            // 可能需要 decodeURI，因为 URL 通常是编码过的
            try {
                // 解码 URL (e.g. %20 -> space)
                refs.add(decodeURIComponent(match[1]));
            } catch (e) {
                refs.add(match[1]);
            }
        }

        return { references: Array.from(refs) };
    }
}
