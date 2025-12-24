/**
 * @file common/interfaces/IDocumentAnalyzer.ts
 */

export interface DocumentInfo {
    filename: string;
    path: string;
    mimeType?: string; // 可选，如果系统能提供 MIME
    size?: number;     // 可选，用于过滤大文件
}

export interface ReferenceExtractionResult {
    /** 提取到的引用文件名列表 (e.g. "image.png") */
    references: string[];
    /** 提取过程中发现的其他元数据 (可选) */
    metadata?: Record<string, any>;
}

export interface AnalysisContext {
    filePath: string;
}

/**
 * 文档分析器接口
 * 负责解析特定格式的文档内容，提取出对外部资源的引用
 */
export interface IDocumentAnalyzer {
    /**
     * 唯一标识符，用于调试或配置
     */
    readonly id: string;

    /**
     * 判断该分析器是否支持处理指定文档
     * @param docInfo 文档的基本信息
     */
    supports(docInfo: DocumentInfo): boolean;

    /**
     * 解析内容并提取引用
     * @param content 文档内容
     * @param context 上下文信息
     */
    analyze(content: string | ArrayBuffer, context: AnalysisContext): Promise<ReferenceExtractionResult>;
}

/**
 * GC 结果统计
 */
export interface GCResult {
    totalAssets: number;
    deletedCount: number;
    orphans: string[]; // 被删除的节点ID列表
    errors: Array<{ path: string, error: string }>;
}