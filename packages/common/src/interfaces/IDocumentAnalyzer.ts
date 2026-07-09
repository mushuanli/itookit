/**
 * @file common/interfaces/IDocumentAnalyzer.ts
 * Internal interface — used only by MarkdownAnalyzer within common.
 * Not exported from the public API.
 */

export interface DocumentInfo {
    filename: string;
    path: string;
    mimeType?: string;
    size?: number;
}

export interface ReferenceExtractionResult {
    references: string[];
    metadata?: Record<string, unknown>;
}

export interface AnalysisContext {
    filePath: string;
}

export interface IDocumentAnalyzer {
    readonly id: string;
    supports(info: DocumentInfo): boolean;
    analyze(content: string | ArrayBuffer, context: AnalysisContext): Promise<ReferenceExtractionResult>;
}

export interface GCResult {
    totalAssets: number;
    deletedCount: number;
    orphans: string[];
    errors: string[];
}
